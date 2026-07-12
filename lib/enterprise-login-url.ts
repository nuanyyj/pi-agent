export function normalizeEnterpriseReturnTo(value: string | null | undefined): string {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) return "/";
  if (value.includes("\\") || /[\u0000-\u001f\u007f]/.test(value)) return "/";
  return value;
}

export function buildEnterpriseLoginUrl(returnTo: string | null | undefined): string {
  return `/api/enterprise/v1/auth/login?returnTo=${encodeURIComponent(normalizeEnterpriseReturnTo(returnTo))}`;
}
