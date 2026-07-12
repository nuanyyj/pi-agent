const DOCKER_IMAGE_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._/-]*(?::[a-zA-Z0-9][a-zA-Z0-9._-]*)?(?:@sha256:[a-fA-F0-9]{64})?$/;

const MODEL_PROVIDER_ENVIRONMENT = [
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "GOOGLE_API_KEY",
  "GEMINI_API_KEY",
  "OPENROUTER_API_KEY",
  "AZURE_OPENAI_API_KEY",
] as const;

interface DockerWorkerLaunchOptions {
  image: string;
  runId: string;
  envelopePath: string;
  workspaceRoot: string;
  postgresUrl: string;
  providerEnvironment: Record<string, string | undefined>;
}

export interface DockerWorkerLaunch {
  args: string[];
  envelopeWorkspaceRoot: "/workspace";
}

function dockerPostgresUrl(connectionString: string): string {
  try {
    const url = new URL(connectionString);
    if (url.hostname === "127.0.0.1" || url.hostname === "localhost" || url.hostname === "::1") {
      url.hostname = "host.docker.internal";
      return url.toString();
    }
  } catch {
    // The worker will return the authoritative connection-string error.
  }
  return connectionString;
}

export function buildDockerWorkerLaunch(options: DockerWorkerLaunchOptions): DockerWorkerLaunch {
  if (!DOCKER_IMAGE_PATTERN.test(options.image)) {
    throw new Error("Invalid Docker worker image reference");
  }

  const args = [
    "run", "--rm",
    "--add-host", "host.docker.internal:host-gateway",
    "--memory", "512m",
    "--cpus", "1",
    "--pids-limit", "256",
    "--read-only",
    "--cap-drop", "ALL",
    "--security-opt", "no-new-privileges:true",
    "--label", `pi-run-id=${options.runId}`,
    "--tmpfs", "/tmp:rw,noexec,nosuid,size=100m",
    "-e", "PI_RUN_ENVELOPE_PATH=/run/envelope.json",
    "-e", `PI_RUN_ID=${options.runId}`,
    "-e", `PI_POSTGRES_URL=${dockerPostgresUrl(options.postgresUrl)}`,
  ];

  for (const name of MODEL_PROVIDER_ENVIRONMENT) {
    const value = options.providerEnvironment[name];
    if (value) args.push("-e", `${name}=${value}`);
  }

  args.push(
    "-v", `${options.envelopePath}:/run/envelope.json:ro`,
    "-v", `${options.workspaceRoot}:/workspace:rw`,
    options.image,
  );

  return { args, envelopeWorkspaceRoot: "/workspace" };
}
