import { realpath, stat } from "node:fs/promises";
import { delimiter, isAbsolute, relative } from "node:path";

export class WorkspacePolicyError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "WorkspacePolicyError";
  }
}

function configuredWorkspaceRoots(): string[] {
  const configured = process.env.PI_ENTERPRISE_WORKSPACE_ROOTS;
  if (!configured) return [process.cwd()];
  return configured.split(delimiter).map((root) => root.trim()).filter(Boolean);
}

function isWithinRoot(target: string, root: string): boolean {
  const pathFromRoot = relative(root, target);
  return pathFromRoot === "" || (!pathFromRoot.startsWith("..") && !isAbsolute(pathFromRoot));
}

/** Resolve and validate a server-side workspace directory before persisting or executing it. */
export async function resolveEnterpriseWorkspaceRoot(
  requestedRoot: string | undefined,
  allowedRoots = configuredWorkspaceRoots(),
): Promise<string> {
  const target = requestedRoot?.trim() || process.cwd();
  if (!isAbsolute(target)) {
    throw new WorkspacePolicyError("Workspace root must be an absolute path", 400);
  }
  if (allowedRoots.length === 0) {
    throw new WorkspacePolicyError("No enterprise workspace roots are configured", 500);
  }

  let resolvedTarget: string;
  try {
    const targetStats = await stat(target);
    if (!targetStats.isDirectory()) throw new Error("not a directory");
    resolvedTarget = await realpath(target);
  } catch {
    throw new WorkspacePolicyError("Workspace root does not exist or is not a directory", 400);
  }

  const resolvedAllowedRoots: string[] = [];
  for (const root of allowedRoots) {
    if (!isAbsolute(root)) {
      throw new WorkspacePolicyError("Configured enterprise workspace roots must be absolute paths", 500);
    }
    try {
      const rootStats = await stat(root);
      if (!rootStats.isDirectory()) throw new Error("not a directory");
      resolvedAllowedRoots.push(await realpath(root));
    } catch {
      throw new WorkspacePolicyError(`Configured enterprise workspace root is unavailable: ${root}`, 500);
    }
  }

  if (!resolvedAllowedRoots.some((root) => isWithinRoot(resolvedTarget, root))) {
    throw new WorkspacePolicyError("Workspace root is outside the configured enterprise roots", 403);
  }
  return resolvedTarget;
}
