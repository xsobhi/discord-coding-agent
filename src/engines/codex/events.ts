import { oneLine } from '../../discord/chunk.ts';
import type { EngineSink, TurnEnd } from '../types.ts';

type Json = Record<string, any>;
/** The running turn, and owner turns steered into it that Codex has not taken a step since. */
export type CodexTurnState = { turnId?: string; unread?: string[] };

const flushUnread = (sink: EngineSink, state: CodexTurnState): void => {
  for (const id of state.unread?.splice(0) ?? []) sink.onRead(id);
};

const short = (path: unknown): string => String(path ?? '').replace(/^\/home\/ubuntu\//, '~/');

/** Codex wraps commands as `/bin/bash -lc '…'`; show the command itself. */
export function plainCommand(command: string): string {
  const m = command.match(/^\/bin\/(?:ba)?sh -l?c '([\s\S]*)'$/);
  return m?.[1] ? m[1].replace(/'\\''/g, "'") : command;
}

/** Turns app-server notifications into thread posts and status-board lines. */
export async function handleCodexEvent(sink: EngineSink, state: CodexTurnState, method: string, p: Json): Promise<void> {
  switch (method) {
    case 'turn/started':
      state.turnId = p.turn?.id;
      return sink.onTurnStart();
    case 'item/started': {
      flushUnread(sink, state);
      const line = describeItem(p.item ?? {});
      if (line) sink.board()?.action(line);
      return;
    }
    case 'item/completed':
      if (p.item?.type === 'agentMessage' && String(p.item.text ?? '').trim()) await sink.onText(p.item.text);
      return;
    case 'item/autoApprovalReview/completed': {
      const status = p.review?.status;
      if (status === 'approved') return;
      const what = p.action?.command ? `\`${oneLine(plainCommand(p.action.command), 80)}\`` : p.action?.type ?? 'an action';
      sink.board()?.push(`⛔ auto review ${status} ${what}${p.review?.rationale ? `: ${oneLine(p.review.rationale, 160)}` : ''}`);
      return;
    }
    case 'thread/compacted':
      sink.board()?.push('🗜️ conversation compacted');
      return;
    case 'model/rerouted':
      sink.board()?.push(`↪️ model rerouted to ${p.toModel ?? p.model ?? 'another model'}`);
      return;
    case 'error':
      sink.board()?.push(p.willRetry ? `⏳ retrying: ${oneLine(p.error?.message ?? '', 120)}` : `⚠️ ${oneLine(p.error?.message ?? 'error', 200)}`);
      return;
    case 'turn/completed':
      state.turnId = undefined;
      // An interrupted turn may never have taken steered input in; the task re-sends what is still unread.
      if (p.turn?.status !== 'interrupted') flushUnread(sink, state);
      state.unread = [];
      await sink.onTurnEnd(turnEnd(p.turn ?? {}));
      return;
    default:
      return;
  }
}

function describeItem(it: Json): string | undefined {
  switch (it.type) {
    case 'commandExecution':
      return `\`shell\` ${oneLine(plainCommand(String(it.command ?? '')), 140)}`;
    case 'fileChange':
      return `\`edit\` ${oneLine((it.changes ?? []).map((c: Json) => short(c.path)).join(', '), 140)}`;
    case 'mcpToolCall': {
      const args = it.arguments && typeof it.arguments === 'object' ? Object.values(it.arguments).find((v) => typeof v === 'string') : '';
      return `\`${it.server}:${it.tool}\` ${oneLine(String(args ?? ''), 120)}`.trim();
    }
    case 'webSearch':
      return `\`web search\` ${oneLine(String(it.query ?? ''), 120)}`;
    case 'collabAgentToolCall':
      return `\`agent\` ${oneLine(String(it.prompt ?? it.tool ?? ''), 120)}`;
    case 'imageView':
      return `\`view image\` ${short(it.path)}`;
    case 'dynamicToolCall':
      return `\`${it.tool}\``;
    default:
      return undefined;
  }
}

function turnEnd(turn: Json): TurnEnd {
  const ms = Number(turn.durationMs ?? 0);
  const minutes = Math.round(ms / 60000);
  const span = `${minutes < 1 ? '<1' : minutes} min`;
  if (turn.status === 'completed') return { status: 'done', span };
  if (turn.status === 'interrupted') return { status: 'interrupted', span };
  const errors = turn.error?.message ? [String(turn.error.message)] : [];
  return { status: 'failed', span, reason: 'stopped with an error', errors };
}
