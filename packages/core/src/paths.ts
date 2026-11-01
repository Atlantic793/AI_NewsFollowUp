import path from "node:path";

export function isInsideFolder(root: string, candidate: string): boolean {
  if (candidate.includes("\0")) return false;
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, candidate);
  const relative = path.relative(resolvedRoot, resolved);
  if (relative === "") return false;
  return !relative.startsWith("..") && !path.isAbsolute(relative);
}
