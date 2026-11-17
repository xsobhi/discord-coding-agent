import { setTimeout as delay } from 'node:timers/promises';
import { errorText } from '../../log.ts';
import type { CodexRpc } from './rpc.ts';

/** Retry only the known writer-release race, always on the same saved thread. */
export async function resumeSavedThread(
  rpc: Pick<CodexRpc, 'call'>, threadId: string, common: Record<string, unknown>,
  waiting: () => void, signal?: AbortSignal,
  sleep: (ms: number) => Promise<void> = (ms) => delay(ms, undefined, { signal }),
): Promise<{ thread: { id: string } }> {
  const pauses = [250, 500, 1000, 2000, 4000, 8000];
  for (let attempt = 0; ; attempt++) {
    signal?.throwIfAborted();
    try {
      return await rpc.call('thread/resume', { ...common, threadId, excludeTurns: true });
    } catch (err) {
      if (!/already has an active writer/i.test(errorText(err)) || attempt >= pauses.length) throw err;
      if (attempt === 0) waiting();
      await sleep(pauses[attempt]);
    }
  }
}
