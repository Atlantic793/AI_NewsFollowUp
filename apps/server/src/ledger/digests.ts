import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

export function validDigestDay(day: string): boolean {
  const date = new Date(`${day}T00:00:00Z`);
  return /^\d{4}-\d{2}-\d{2}$/.test(day) && !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === day;
}

export async function listDigests(dataDir: string) {
  const folder = path.join(dataDir, "digests");
  const files = await readdir(folder).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return [];
    throw error;
  });
  return Promise.all(files.filter((file) => /^\d{4}-\d{2}-\d{2}\.md$/.test(file)).sort().reverse().map(async (file) => {
    const info = await stat(path.join(folder, file));
    return { day: file.slice(0, 10), bytes: info.size, updatedAt: info.mtime.toISOString() };
  }));
}

export function readDigest(dataDir: string, day: string) {
  return readFile(path.join(dataDir, "digests", `${day}.md`), "utf8");
}
