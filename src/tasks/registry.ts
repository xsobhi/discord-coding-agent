import { randomUUID } from 'node:crypto';
import type { Client, Message } from 'discord.js';
import { isOwner } from '../config.ts';
import { getDefaults } from '../engines/settings.ts';
import { settleTier } from '../guests/guest.ts';
import { allRecords, dropRecord, getRecord, saveRecord, type TaskRecord } from '../store.ts';
import type { Venue } from '../discord/thread.ts';
import { log } from '../log.ts';
import { setBusyCheck } from './lifecycle.ts';
import type { OtherTask } from './prompt.ts';
import { Task } from './task.ts';
import { bindContinuation } from './continuation.ts';

const live = new Map<string, Task>();
setBusyCheck(() => [...live.values()].some((t) => t.deploymentBusy));

export const busyCount = (): number => [...live.values()].filter((t) => t.busy).length;
/** A guest runs one task at a time. */
export const guestBusy = (userId: string): boolean => [...live.values()].some((t) => t.busy && t.record.ownerId === userId);

export function newTask(client: Client, origin: Message, venue: Venue, title: string): Task {
  const record: TaskRecord = {
    id: randomUUID().slice(0, 8),
    threadId: venue.threadId,
    ownThread: venue.ownThread,
    title,
    ownerId: origin.author.id,
    originChannelId: origin.channel.id,
    originMessageId: origin.id,
    guildId: origin.guildId,
    agent: getDefaults(),
    sessions: {},
    tier: isOwner(origin.author.id) ? 'owner' : 'guest',
    state: 'idle',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  bindContinuation(record);
  saveRecord(record);
  const task = new Task(client, record, venue.channel, origin);
  live.set(venue.threadId, task);
  return task;
}

/** The task living in a channel, rebuilt from the store after a restart if needed. */
export async function taskIn(client: Client, threadId: string): Promise<Task | undefined> {
  const existing = live.get(threadId);
  if (existing) return existing;
  const record = getRecord(threadId);
  if (!record || record.state === 'closed') return undefined;
  if (settleTier(record)) saveRecord(record);
  const channel = await client.channels.fetch(threadId).catch(() => null);
  if (!channel?.isSendable()) return undefined;
  // A message may have restored the same task while the channel fetch was in flight.
  const restored = live.get(threadId);
  if (restored) return restored;
  const task = new Task(client, record, channel);
  live.set(threadId, task);
  return task;
}

export const hasTask = (threadId: string): boolean => live.has(threadId) || Boolean(getRecord(threadId) && getRecord(threadId)?.state !== 'closed');

/** The thread a request message started: one opened on it shares its id; a private one is found by its record. */
export function requestThread(messageId: string): string | undefined {
  if (hasTask(messageId)) return messageId;
  return allRecords().find((r) => r.ownThread && r.originMessageId === messageId && r.state !== 'closed')?.threadId;
}

export function otherTasks(exceptThreadId: string): OtherTask[] {
  return [...live.values()]
    .filter((t) => t.record.threadId !== exceptThreadId && t.busy)
    .map((t) => ({ title: t.record.title, threadId: t.record.threadId, state: 'running' }));
}

/** Forget a channel's task (a DM "new"): the next message starts a fresh session. */
export function retire(threadId: string): void {
  const task = live.get(threadId);
  task?.closeSession();
  live.delete(threadId);
  const record = getRecord(threadId);
  if (!record) return;
  dropRecord(threadId);
  saveRecord({ ...record, state: 'closed', threadId: `${threadId}:closed:${record.id}` });
}

/** Tasks that were mid-turn when the bot went down: tell their threads. */
export async function noticeInterrupted(client: Client): Promise<void> {
  for (const record of allRecords().filter((r) => r.state === 'running')) {
    record.state = 'idle';
    saveRecord(record);
    const channel = await client.channels.fetch(record.threadId).catch(() => null);
    if (!channel?.isSendable()) continue;
    log.info(`task ${record.id} was interrupted by a restart`);
    await channel.send('⚠️ The bot restarted while I was working on this. Reply here and I will pick up where I left off.').catch(() => undefined);
  }
}

export async function shutdownAll(): Promise<void> {
  // Failures are logged by the session slot; one stuck process must not stop the others closing.
  await Promise.allSettled([...live.values()].map((task) => task.closeSession()));
}
