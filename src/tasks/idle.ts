import { config } from '../config.ts';

/** How long a session whose background jobs are still running stays up after its last turn. */
const BACKGROUND_KEEP_MS = 6 * 60 * 60_000;

/**
 * Closes a task's engine process once it has been idle for a while, unless a
 * background job it started is still running: that job's result arrives as a
 * new turn, which a closed process would never see.
 */
export class IdleCloser {
  /** Background jobs the engine reports still running. */
  background = 0;
  private timer?: NodeJS.Timeout;
  private readonly close: () => void;

  constructor(close: () => void) {
    this.close = close;
  }

  arm(): void {
    this.cancel();
    const since = Date.now();
    const check = (): void => {
      if (this.background > 0 && Date.now() - since < BACKGROUND_KEEP_MS) {
        this.timer = setTimeout(check, 60_000);
        return;
      }
      this.close();
    };
    this.timer = setTimeout(check, config.idleCloseMinutes * 60_000);
  }

  cancel(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
  }
}
