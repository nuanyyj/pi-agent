/**
 * Credential sanitizer for enterprise events and tool outputs.
 *
 * Redacts sensitive values (API keys, tokens, passwords, connection strings)
 * before they are stored in PG events or pushed via SSE to the browser.
 *
 * Patterns are intentionally conservative — false positives are acceptable,
 * false negatives are not.
 */

// ── Patterns ──────────────────────────────────────────────────────────

interface RedactionRule {
  /** Regex to find the sensitive value itself */
  pattern: RegExp;
  /** Replacement string (uses $1 for captured key prefix if applicable) */
  replacement: string;
}

const RULES: RedactionRule[] = [
  // Bearer tokens / generic auth headers
  {
    pattern: /((?:bearer|authorization|auth)[\s:=]+)[^\s,;)]+/gi,
    replacement: "$1[REDACTED]",
  },
  // API key patterns (sk-, key-, api_key=, etc.)
  {
    pattern: /((?:sk|api[_-]?key|apikey|secret[_-]?key|access[_-]?key|private[_-]?key)[\s:=]*['"]?)[A-Za-z0-9_\-]{16,}(['"]?)/gi,
    replacement: "$1[REDACTED]$2",
  },
  // Environment variable exports with secrets
  {
    pattern: /(export\s+[A-Z_]*(?:KEY|SECRET|TOKEN|PASSWORD|CREDENTIAL|AUTH)[A-Z_]*=)['"]?[^'";\s]+(['"]?)/gi,
    replacement: "$1[REDACTED]$2",
  },
  // Connection strings with passwords (postgres://, mysql://, mongodb://, redis://)
  {
    pattern: /((?:postgres|mysql|mongodb|redis|amqp|mssql):\/\/[^:]+:)[^@]+(@)/gi,
    replacement: "$1[REDACTED]$2",
  },
  // Generic password assignments
  {
    pattern: /(password[\s:=]*['"]?)[^'";\s]+(['"]?)/gi,
    replacement: "$1[REDACTED]$2",
  },
  // PEM private key blocks
  {
    pattern: /-----BEGIN\s+(?:RSA\s+)?PRIVATE\s+KEY-----[\s\S]*?-----END\s+(?:RSA\s+)?PRIVATE\s+KEY-----/g,
    replacement: "[REDACTED: PRIVATE KEY]",
  },
  // AWS-style access keys
  {
    pattern: /((?:AKIA|ASIA)[A-Z0-9]{16})/g,
    replacement: "[REDACTED: AWS KEY]",
  },
  // GitHub / GitLab tokens (ghp_, glpat-, gho_, ghs_, ghr_)
  {
    pattern: /((?:ghp|glpat|gho|ghs|ghr)_[A-Za-z0-9]{20,})/g,
    replacement: "$1[REDACTED]",
  },
];

// ── Public API ────────────────────────────────────────────────────────

/**
 * Sanitize a string by redacting sensitive values.
 * Safe for all text — tool output, event data, log lines.
 */
export function sanitizeString(text: string): string {
  let result = text;
  for (const rule of RULES) {
    // Reset lastIndex for global regexes
    rule.pattern.lastIndex = 0;
    result = result.replace(rule.pattern, rule.replacement);
  }
  return result;
}

/**
 * Deep-sanitize an object tree. Returns a new object with all string
 * values sanitized. Non-string leaves are passed through unchanged.
 */
export function sanitizeObject<T>(obj: T): T {
  if (typeof obj === "string") return sanitizeString(obj) as T;
  if (obj === null || typeof obj !== "object") return obj;
  if (Array.isArray(obj)) return obj.map(sanitizeObject) as T;

  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    // Skip keys that are themselves secrets — redact the entire value
    if (/(?:secret|token|password|credential|authorization)/i.test(key) && typeof value === "string") {
      out[key] = "[REDACTED]";
    } else {
      out[key] = sanitizeObject(value);
    }
  }
  return out as T;
}
