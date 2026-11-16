import { rmSync, statSync } from 'node:fs';
import { workDir } from '../discord/attachments.ts';
import { log } from '../log.ts';
import { allRecords } from '../store.ts';
import { isGuestTask } from './guest.ts';

/** How long a guest's downloaded attachments stay, counted from the last file added to the task. */
const KEEP_MS = 2 * 60 * 60_000;

/**
 * Guests' attachments (the only guest files ever on this disk; what make_files
 * produces is posted straight from memory) are deleted once a task has been
 * quiet for two hours. Checked every half hour.
 */
export function startGuestCleanup(): void {
  const sweep = (): void => {
    for (const record of allRecords()) {
      if (!isGuestTask(record)) continue;
      const dir = workDir(record.id);
      try {
        if (Date.now() - statSync(dir).mtimeMs < KEEP_MS) continue;
      } catch {
        continue;
      }
      rmSync(dir, { recursive: true, force: true });
      log.info(`deleted guest task ${record.id}'s attachments`);
    }
  };
  sweep();
  setInterval(sweep, 30 * 60_000).unref();
}
