import { describe, expect, it } from "vitest";
import { sanitizeString, sanitizeObject } from "../../lib/enterprise/sanitizer";

describe("sanitizeString", () => {
  it("redacts Bearer tokens", () => {
    const input = "Authorization: Bearer sk-abc123secrettoken";
    const result = sanitizeString(input);
    expect(result).toBe("Authorization: Bearer [REDACTED]");
    expect(result).not.toContain("sk-abc123secrettoken");
  });

  it("redacts API keys with common prefixes", () => {
    const input = "api_key=sk-proj_abcdefghijklmnopqrstuvwxyz";
    const result = sanitizeString(input);
    expect(result).not.toContain("sk-proj_abcdefghijklmnop");
    expect(result).toContain("[REDACTED]");
  });

  it("redacts connection string passwords", () => {
    const input = "postgres://admin:SuperSecret123@db.example.com:5432/mydb";
    const result = sanitizeString(input);
    expect(result).not.toContain("SuperSecret123");
    expect(result).toContain("postgres://admin:[REDACTED]@db.example.com");
  });

  it("redacts password assignments", () => {
    const input = 'password="hunter2"';
    const result = sanitizeString(input);
    expect(result).not.toContain("hunter2");
    expect(result).toContain("password=\"[REDACTED]\"");
  });

  it("redacts PEM private key blocks", () => {
    const input = "-----BEGIN PRIVATE KEY-----\nMIIBVAIBADANBg...\n-----END PRIVATE KEY-----";
    const result = sanitizeString(input);
    expect(result).toBe("[REDACTED: PRIVATE KEY]");
  });

  it("redacts AWS access keys", () => {
    const input = "AKIAIOSFODNN7EXAMPLE";
    const result = sanitizeString(input);
    expect(result).toContain("[REDACTED: AWS KEY]");
    expect(result).not.toContain("AKIAIOSFODNN7EXAMPLE");
  });

  it("redacts GitHub tokens", () => {
    const input = "ghp_abcdefghijklmnopqrstuvwxyz1234";
    const result = sanitizeString(input);
    expect(result).toContain("[REDACTED]");
    expect(result).not.toContain("ghp_abcdefghijklmnopqrstuvwxyz1234");
  });

  it("leaves non-sensitive text unchanged", () => {
    const input = "Hello world, this is a normal message.";
    expect(sanitizeString(input)).toBe(input);
  });

  it("handles empty strings", () => {
    expect(sanitizeString("")).toBe("");
  });
});

describe("sanitizeObject", () => {
  it("sanitizes nested string values", () => {
    const input = {
      name: "test",
      config: {
        apiKey: "sk-verylongsecretkey12345678",
        host: "localhost",
      },
    };
    const result = sanitizeObject(input);
    expect(result.name).toBe("test");
    expect(result.config.host).toBe("localhost");
    // apiKey field name contains "key" + "Key" pattern
    expect(result.config.apiKey).not.toContain("sk-verylongsecretkey");
  });

  it("redacts fields whose key matches secret patterns", () => {
    const input = {
      token: "some-long-token-value-here",
      secret: "my-secret-value",
      normal: "visible",
    };
    const result = sanitizeObject(input);
    expect(result.token).toBe("[REDACTED]");
    expect(result.secret).toBe("[REDACTED]");
    expect(result.normal).toBe("visible");
  });

  it("handles arrays", () => {
    const input = ["normal text", "Bearer sk-secretkey12345678"];
    const result = sanitizeObject(input);
    expect(result[0]).toBe("normal text");
    expect(result[1]).not.toContain("sk-secretkey12345678");
  });

  it("passes through numbers and booleans", () => {
    const input = { count: 42, active: true };
    const result = sanitizeObject(input);
    expect(result.count).toBe(42);
    expect(result.active).toBe(true);
  });
});
