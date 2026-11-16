import { flushStore } from '../store.ts';
import { log } from '../log.ts';

/** Display strings for the owners, filled in once the bot has logged in. */
let owners: string[] = [];
export const setOwnerLabels = (labels: string[]): void => {
  owners = labels;
};
export const ownerLabels = (): string[] => owners;

let restartWanted = false;
let isBusy: () => boolean = () => false;
let activity = 0;
let restartTimer: NodeJS.Timeout | undefined;

/** Include context gathering and message delivery in the idle check. */
export async function trackActivity<T>(action: () => Promise<T>): Promise<T> {
  activity++;
  try { return await action(); }
  finally { activity--; maybeRestart(); }
}

/** The registry tells us whether any task is mid-turn. */
export const setBusyCheck = (check: () => boolean): void => {
  isBusy = check;
};

/** Asked for by the restart_self tool; happens once no task is mid-turn. */
export function requestRestart(): void {
  restartWanted = true;
  log.info('restart requested');
}

export function maybeRestart(): void {
  if (!restartWanted || activity || isBusy() || restartTimer) return;
  restartTimer = setTimeout(() => {
    restartTimer = undefined;
    // A new owner message or background completion may have arrived during the grace period.
    if (activity || isBusy()) return;
    log.info('restarting as requested (your process manager brings the bot back)');
    flushStore();
    process.exit(0);
  }, 1500);
}
