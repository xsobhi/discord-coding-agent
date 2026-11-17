import { readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const SKIP = new Set(['node_modules', '.git', '.venv', 'venv', '__pycache__', 'AppData']);

/** The Windows stand-in for `find -maxdepth 5 -name '.env*'`: no `find` there. Never follows links or junctions. */
export async function windowsEnvFiles(roots: string[]): Promise<string[]> {
  const found = new Set<string>();
  const visited = new Set<string>();
  const deadline = Date.now() + 20_000; // the same budget as the Linux scan
  async function walk(path: string, depth: number): Promise<void> {
    const key = resolve(path).toLowerCase();
    if (depth > 4 || visited.has(key) || Date.now() > deadline) return;
    visited.add(key);
    const entries = await readdir(path, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const file = join(path, entry.name);
      if (entry.isFile() && /^\.env(?:\..*)?$/.test(entry.name)) found.add(file);
      else if (entry.isDirectory() && !SKIP.has(entry.name)) await walk(file, depth + 1);
    }
  }
  for (const root of roots) await walk(root, 0);
  return [...found];
}
