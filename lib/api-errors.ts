/**
 * Safe error responses for API routes.
 *
 * Never expose internal details (file paths, stack traces, SQL errors) to
 * the client. Log the full error server-side and return a generic message.
 */

export function sanitizeError(error: unknown): string {
  // Log full error for server-side debugging
  console.error("[api-error]", error);

  if (error instanceof Error) {
    // Known safe error messages
    if (error.name === "SessionError") return error.message;
    if (error.message.includes("not found")) return "Resource not found";
    if (error.message.includes("permission")) return "Permission denied";
    if (error.message.includes("required")) return error.message;
  }

  return "Internal server error";
}

export function errorResponse(error: unknown, status = 500) {
  return { error: sanitizeError(error) };
}
