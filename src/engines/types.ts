import type { SendableChannels } from 'discord.js';
import type { Guest } from '../guests/guest.ts';
import type { ToolHost } from '../mcp/util.ts';
import type { StatusBoard } from '../tasks/status.ts';

export type Engine = 'claude' | 'codex';
export const ENGINES: Engine[] = ['claude', 'codex'];
export const ENGINE_LABEL: Record<Engine, string> = { claude: 'Claude Code', codex: 'Codex' };

export type EngineChoice = { model: string; effort?: string };

/** The engine a task (or the bot-wide default) uses, plus the model/effort remembered for each engine. */
export type AgentSettings = { engine: Engine } & Record<Engine, EngineChoice>;

/**
 * An owner's (or guest's) turn: its id, their words, other people's words (context only), local images, and
 * in a guest task the attachments to hand over inline (`files`), since a guest's agent cannot Read.
 */
export type OwnerTurn = { id: string; text: string; pasted: string[]; images: string[]; files?: string[] };

/** How a turn ended. `span` is the duration line; `reason` explains a failure. */
export type TurnEnd = { status: 'done' | 'failed' | 'interrupted'; span: string; reason?: string; errors?: string[]; more?: boolean };

/** What a running session reports back to the task that owns it. */
export interface EngineSink {
  channel: SendableChannels;
  board(): StatusBoard | undefined;
  /** The engine's own session/thread id (saved for resume) and a footer line. */
  onSession(id: string, footer: string, warning?: string): void;
  onText(text: string): Promise<void>;
  /** The engine began a turn nobody sent (a background job finished), or one that missed the running turn. */
  onTurnStart(): Promise<void>;
  /** The agent has now seen this owner turn (it can sit queued behind a running step). */
  onRead(turnId: string): void;
  /** How many background jobs (commands left running) the session has. */
  onBackground(count: number): void;
  onTurnEnd(end: TurnEnd): Promise<void>;
  /** The engine process is gone; `crash` when that happened mid-turn. */
  onClosed(crash?: string): Promise<void>;
  waiting(note: string): void;
  working(): void;
}

export interface EngineSession {
  readonly engine: Engine;
  readonly choice: EngineChoice;
  /** True when a different model/effort needs a fresh process (Claude); Codex switches per turn. */
  needsRestartFor(choice: EngineChoice): boolean;
  /** Starts a turn, or queues it behind the running one; `onRead` says when the agent sees it. */
  send(turn: OwnerTurn, choice: EngineChoice): Promise<void>;
  interrupt(): Promise<void>;
  close(): void;
}

/** `guest`: the task belongs to a restricted user, so the engine runs sandboxed (see guests/guest.ts). */
export type SessionHost = ToolHost & { owners: string[]; resume?: string; sink: EngineSink; driver(): string | undefined; guest?: Guest };

export const sameChoice = (a: EngineChoice, b: EngineChoice): boolean => a.model === b.model && (a.effort ?? '') === (b.effort ?? '');
