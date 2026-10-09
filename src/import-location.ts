export const importDirectoryKey = "yingkuang-import-directory-v1";

export function selectedImportDirectory(selection: string | string[], source: "files" | "folder"): string | undefined {
  const path = Array.isArray(selection) ? selection[0] : selection;
  if (!path) return undefined;
  if (source === "folder") return path;
  const separator = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  if (separator < 0) return undefined;
  // Keep filesystem roots intact on Unix, Windows drives and UNC shares.
  if (separator === 0 || (separator === 2 && path[1] === ":")) return path.slice(0, separator + 1);
  return path.slice(0, separator);
}

export function readImportDirectory(): string | undefined {
  try { return localStorage.getItem(importDirectoryKey) || undefined; }
  catch { return undefined; }
}
