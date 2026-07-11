import { existsSync, readdirSync, readFileSync } from "node:fs";
import { extname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";

const FORBIDDEN_PREFIXES = [
  "@/lib/rpc-manager",
  "@/lib/session-reader",
  "@/lib/file-access",
  "@/lib/worktree",
  "@earendil-works/pi-coding-agent/rpc-entry",
];

function isForbidden(specifier) {
  return FORBIDDEN_PREFIXES.some(
    (prefix) => specifier === prefix || specifier.startsWith(`${prefix}/`),
  );
}

export function findForbiddenImports(fileName, sourceText) {
  const scriptKind = extname(fileName) === ".tsx" ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const source = ts.createSourceFile(
    fileName,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    scriptKind,
  );
  const failures = [];

  function visit(node) {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier) &&
      isForbidden(node.moduleSpecifier.text)
    ) {
      failures.push(node.moduleSpecifier.text);
    }

    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const argument = node.arguments[0];
      if (argument && ts.isStringLiteral(argument) && isForbidden(argument.text)) {
        failures.push(argument.text);
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(source);
  return failures;
}

function collectTypeScriptFiles(directory) {
  const files = [];

  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectTypeScriptFiles(path));
      continue;
    }
    if (entry.isFile() && [".ts", ".tsx"].includes(extname(entry.name))) {
      files.push(path);
    }
  }

  return files;
}

function collectScanRoots(rootDir) {
  const roots = [];
  const platformDir = resolve(rootDir, "platform");
  if (existsSync(platformDir)) roots.push(platformDir);

  const packagesDir = resolve(rootDir, "packages");
  if (!existsSync(packagesDir)) return roots;

  for (const entry of readdirSync(packagesDir, { withFileTypes: true })) {
    if (entry.isDirectory() && entry.name.startsWith("enterprise-")) {
      roots.push(resolve(packagesDir, entry.name));
    }
  }

  return roots;
}

export function main(rootDir) {
  const failures = [];

  for (const scanRoot of collectScanRoots(rootDir)) {
    for (const file of collectTypeScriptFiles(scanRoot)) {
      const sourceText = readFileSync(file, "utf8");
      for (const specifier of findForbiddenImports(file, sourceText)) {
        failures.push(`${relative(rootDir, file)}:${specifier}`);
      }
    }
  }

  if (failures.length > 0) {
    for (const failure of failures) console.error(failure);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main(fileURLToPath(new URL("..", import.meta.url)));
}
