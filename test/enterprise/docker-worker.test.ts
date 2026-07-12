import { describe, expect, it } from "vitest";
import { buildDockerWorkerLaunch } from "../../lib/enterprise/docker-worker";

describe("buildDockerWorkerLaunch", () => {
  it("mounts the host workspace at the fixed container workspace", () => {
    const launch = buildDockerWorkerLaunch({
      image: "pi-enterprise-worker:dev",
      runId: "run-1",
      envelopePath: "E:\\tmp\\envelope.json",
      workspaceRoot: "E:\\projects\\customer-a",
      postgresUrl: "postgres://user:pass@host.docker.internal:5432/pi",
      providerEnvironment: { OPENAI_API_KEY: "secret" },
    });

    expect(launch.envelopeWorkspaceRoot).toBe("/workspace");
    expect(launch.args).toContain("E:\\projects\\customer-a:/workspace:rw");
    expect(launch.args).toContain("E:\\tmp\\envelope.json:/run/envelope.json:ro");
    expect(launch.args).toContain("PI_RUN_ENVELOPE_PATH=/run/envelope.json");
  });

  it("passes only supported model provider variables", () => {
    const launch = buildDockerWorkerLaunch({
      image: "pi-enterprise-worker",
      runId: "run-2",
      envelopePath: "/tmp/envelope.json",
      workspaceRoot: "/srv/workspace",
      postgresUrl: "postgres://db/pi",
      providerEnvironment: {
        OPENAI_API_KEY: "openai-key",
        ANTHROPIC_API_KEY: "anthropic-key",
        UNRELATED_SECRET: "must-not-leak",
      },
    });

    expect(launch.args).toContain("OPENAI_API_KEY=openai-key");
    expect(launch.args).toContain("ANTHROPIC_API_KEY=anthropic-key");
    expect(launch.args.join("\n")).not.toContain("UNRELATED_SECRET");
    expect(launch.args.join("\n")).not.toContain("must-not-leak");
  });

  it("rejects invalid image references before process launch", () => {
    expect(() => buildDockerWorkerLaunch({
      image: "worker; whoami",
      runId: "run-3",
      envelopePath: "/tmp/envelope.json",
      workspaceRoot: "/srv/workspace",
      postgresUrl: "postgres://db/pi",
      providerEnvironment: {},
    })).toThrow("Invalid Docker worker image reference");
  });

  it("rewrites a host loopback PostgreSQL URL for Docker Desktop", () => {
    const launch = buildDockerWorkerLaunch({
      image: "pi-enterprise-worker",
      runId: "run-4",
      envelopePath: "E:\\tmp\\envelope.json",
      workspaceRoot: "E:\\projects\\customer-a",
      postgresUrl: "postgres://user:pass@127.0.0.1:25432/pi_enterprise",
      providerEnvironment: {},
    });

    expect(launch.args).toContain("host.docker.internal:host-gateway");
    expect(launch.args).toContain(
      "PI_POSTGRES_URL=postgres://user:pass@host.docker.internal:25432/pi_enterprise",
    );
    expect(launch.args).not.toContain("host");
  });
});
