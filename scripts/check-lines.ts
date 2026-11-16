// Every source file stays at or under 200 lines (the owner's rule for all repos here).
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const MAX = 200;
const walk = (dir: string): string[] => readdirSync(dir).flatMap((name) => {
  const path = join(dir, name);
  return statSync(path).isDirectory() ? walk(path) : path.endsWith('.ts') ? [path] : [];
});
const over = [...walk('src'), ...walk('scripts')]
  .map((path) => ({ path, lines: readFileSync(path, 'utf8').split('\n').length - 1 }))
  .filter((f) => f.lines > MAX);
for (const f of over) console.log(`${f.lines} ${f.path}`);
if (over.length) process.exit(1);
console.log(`all files <= ${MAX} lines`);
