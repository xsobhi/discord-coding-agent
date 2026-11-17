import { SessionCleanupError, type EngineSession } from '../engines/types.ts';
import { errorText, log } from '../log.ts';

/** A new process cannot open until the previous process has finished closing. */
export class SessionSlot {
  current?: EngineSession;
  private generation = 0;
  private closing: Promise<void> = Promise.resolve();
  private opening?: { raw: Promise<EngineSession>; result: Promise<EngineSession> };

  get busy(): boolean { return Boolean(this.opening); }

  ensure(open: (live: () => boolean) => Promise<EngineSession>): Promise<EngineSession> {
    if (this.current) return Promise.resolve(this.current);
    if (this.opening) return this.opening.result;
    const generation = ++this.generation;
    const live = (): boolean => generation === this.generation;
    const raw = this.closing.then(() => {
      if (!live()) throw new Error('Session opening was cancelled');
      return open(live);
    });
    const result = raw.then((session) => {
      // close() retains raw so it can dispose an opening that completed late.
      if (!live()) throw new Error('Session closed while opening');
      this.current = session;
      return session;
    });
    const pending = { raw, result };
    this.opening = pending;
    void result.finally(() => {
      if (this.opening === pending) this.opening = undefined;
    }).catch(() => undefined);
    return result;
  }

  close(): Promise<void> {
    this.generation++;
    const session = this.current, pending = this.opening;
    this.current = undefined;
    this.opening = undefined;
    this.closing = this.closing.then(async () => {
      await session?.close();
      // An unsuccessful open cleans up its own resources before rejecting.
      const late = await pending?.raw.catch((err) => {
        if (err instanceof SessionCleanupError) throw err;
        return undefined;
      });
      if (late && late !== session) await late.close();
    });
    void this.closing.catch((err) => log.error('session cleanup failed', errorText(err)));
    return this.closing;
  }
}
