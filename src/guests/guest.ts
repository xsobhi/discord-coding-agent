import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Client } from 'discord.js';
import { config, isOwner } from '../config.ts';
import type { TaskRecord } from '../store.ts';

/**
 * A restricted user's task: who they are, their sandbox directory, and whether they may have code run
 * (remotely, in a Modal sandbox) to make files.
 */
export type Guest = { id: string; label: string; home: string; files: boolean };

/** Anyone but an owner who has a task is a guest there (an ex-owner too): the sandbox is the default. */
export const isGuestTask = (record: TaskRecord): boolean => !isOwner(record.ownerId);

/**
 * Sessions belong to the tier they were made in. A record that moved tiers
 * (a task from when that person was an owner) starts fresh, so a guest never
 * resumes a transcript full of the server's files. True when it changed.
 */
export function settleTier(record: TaskRecord): boolean {
  const tier = isGuestTask(record) ? 'guest' : 'owner';
  if ((record.tier ?? 'owner') === tier) return false;
  record.tier = tier;
  record.sessions = {};
  delete record.lastEngine;
  return true;
}

/** The guest a task runs for, or undefined for an owner's task. */
export function guestFor(record: TaskRecord, client: Client): Guest | undefined {
  if (!isGuestTask(record)) return undefined;
  const id = record.ownerId;
  const home = join(config.guestHome, id.replace(/\D/g, '') || 'unknown');
  mkdirSync(home, { recursive: true, mode: 0o700 });
  const user = client.users.cache.get(id);
  const label = user ? `${user.globalName ?? user.username} (@${user.username}, id ${id})` : `Discord user ${id}`;
  return { id, label, home, files: config.guestFiles.has(id) };
}
