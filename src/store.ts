import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { config } from './config.ts';
import { getDefaults } from './engines/settings.ts';
import type { AgentSettings, Engine } from './engines/types.ts';
import { log, errorText } from './log.ts';

/** What survives a restart: enough to resume the engine's session in its thread. */
export type TaskRecord = {
  id: string;
  /** The channel the task talks in: its own thread, a borrowed thread, or a DM. */
  threadId: string;
  /** True when the bot created the thread, so every owner message there is meant for it. */
  ownThread: boolean;
  title: string;
  ownerId: string;
  originChannelId: string;
  originMessageId: string;
  guildId: string | null;
  /** Engine, model and effort for this task (copied from the defaults when it starts). */
  agent: AgentSettings;
  /** Each engine's own session/thread id in this task, for resuming. */
  sessions: Partial<Record<Engine, string>>;
  /** The engine that ran the latest turn; switching hands the thread history to the other. */
  lastEngine?: Engine;
  /** Before Codex: the Claude session id. Migrated into `sessions` on load. */
  sessionId?: string;
  /** The tier its sessions were made in: a guest task never resumes an owner-tier session, or the reverse. */
  tier?: 'owner' | 'guest';
  state: 'running' | 'idle' | 'closed';
  createdAt: string;
  updatedAt: string;
};

const file = join(config.dataDir, 'tasks.json');
let records: Record<string, TaskRecord> = {};
let timer: NodeJS.Timeout | undefined;

export function loadStore(): void {
  mkdirSync(config.dataDir, { recursive: true });
  try {
    records = JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    records = {};
  }
  for (const r of Object.values(records)) migrate(r);
}

/** Records from before Codex: one Claude session id and no settings. Call after loadSettings(). */
function migrate(r: TaskRecord): void {
  r.sessions ??= r.sessionId ? { claude: r.sessionId } : {};
  if (r.sessionId) r.lastEngine ??= 'claude';
  delete r.sessionId;
  r.agent ??= { ...getDefaults(), engine: 'claude' };
}

function flush(): void {
  timer = undefined;
  try {
    writeFileSync(`${file}.tmp`, JSON.stringify(records, null, 2));
    renameSync(`${file}.tmp`, file);
  } catch (err) {
    log.error('store write failed', errorText(err));
  }
}

function scheduleFlush(): void {
  timer ??= setTimeout(flush, 300);
}

export function flushStore(): void {
  if (timer) clearTimeout(timer);
  flush();
}

export const getRecord = (threadId: string): TaskRecord | undefined => records[threadId];

export const allRecords = (): TaskRecord[] => Object.values(records);

export function saveRecord(record: TaskRecord): void {
  record.updatedAt = new Date().toISOString();
  records[record.threadId] = record;
  scheduleFlush();
}

export function dropRecord(threadId: string): void {
  delete records[threadId];
  scheduleFlush();
}
