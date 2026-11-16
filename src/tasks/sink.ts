import { postText } from '../discord/send.ts';
import type { Engine, EngineSink } from '../engines/types.ts';
import { saveRecord } from '../store.ts';
import type { Task } from './task.ts';
import { trackActivity } from './lifecycle.ts';

/**
 * The callbacks one engine session reports through. `live()` turns false once
 * the task has replaced or closed that session, so its late events are dropped.
 */
export function makeSink(task: Task, engine: Engine, live: () => boolean): EngineSink {
  let warned = false;
  return {
    channel: task.channel,
    board: () => (live() ? task.board() : undefined),
    onSession(id, footer, warning) {
      if (!live()) return;
      task.record.sessions[engine] = id;
      saveRecord(task.record);
      task.footer = footer;
      const board = task.board();
      if (board) board.footer = footer;
      if (warning && !warned) {
        warned = true;
        void postText(task.channel, warning);
      }
    },
    async onText(text) {
      if (live()) await trackActivity(() => postText(task.channel, text));
    },
    async onTurnStart() {
      if (live()) await trackActivity(() => task.engineTurnStarted());
    },
    onRead(turnId) {
      if (live()) task.inbox.read(turnId);
    },
    onBackground(count) {
      if (live()) task.backgroundChanged(count);
    },
    async onTurnEnd(end) {
      if (live()) await trackActivity(() => task.turnEnded(end));
    },
    async onClosed(crash) {
      if (live()) await trackActivity(() => task.sessionClosed(crash));
    },
    waiting(note) {
      if (live()) task.board()?.setPhase('waiting', note);
    },
    working() {
      if (live()) task.board()?.setPhase('working');
    },
  };
}
