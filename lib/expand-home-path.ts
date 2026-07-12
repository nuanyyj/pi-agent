export function expandHomePath(input: string, homeDirectory: string): string {
  if (!homeDirectory || (input !== "~" && !input.startsWith("~/"))) return input;
  if (input === "~") return homeDirectory;
  const separator = homeDirectory.includes("\\") ? "\\" : "/";
  const home = homeDirectory.replace(/[\\/]+$/, "");
  const suffix = input.slice(2).replace(/[\\/]+/g, separator);
  return `${home}${separator}${suffix}`;
}
