import type { Client, Message, SendableChannels, TextBasedChannel } from 'discord.js';
import { errorText } from '../log.ts';

export type ToolResult = { content: { type: 'text'; text: string }[]; isError?: boolean };

/** What the per-task MCP tools need from the running task. */
export type ToolHost = {
  client: Client;
  channel: SendableChannels;
  threadId: string;
  taskId: string;
  requestRestart(): void;
  /** The owner to ping when a tool waits on an owner's button. */
  driver?(): string | undefined;
  /** Renames the task's own thread. */
  retitle?(title: string): Promise<string>;
};

export const ok = (text: string): ToolResult => ({ content: [{ type: 'text', text }] });
export const fail = (text: string): ToolResult => ({ content: [{ type: 'text', text }], isError: true });

/** Runs a tool body and turns any throw into a readable tool error. */
export async function guard(body: () => Promise<ToolResult>): Promise<ToolResult> {
  try {
    return await body();
  } catch (err) {
    return fail(`Error: ${errorText(err)}`);
  }
}

export async function textChannel(client: Client, id: string): Promise<TextBasedChannel> {
  const ch = await client.channels.fetch(id).catch(() => null);
  if (!ch) throw new Error(`channel ${id} not found or not visible to the bot`);
  if (!ch.isTextBased()) throw new Error(`channel ${id} is not a text channel (try list_channels for its threads)`);
  return ch;
}

/** Fetches up to `limit` messages going back from `before` (newest first from Discord), oldest first out. */
export async function fetchHistory(ch: TextBasedChannel, limit: number, before?: string): Promise<Message[]> {
  const out: Message[] = [];
  let cursor = before;
  while (out.length < limit) {
    const page = await ch.messages.fetch({ limit: Math.min(100, limit - out.length), ...(cursor ? { before: cursor } : {}) });
    if (!page.size) break;
    const sorted = [...page.values()].sort((a, b) => b.createdTimestamp - a.createdTimestamp);
    out.push(...sorted);
    cursor = sorted[sorted.length - 1]?.id;
    if (page.size < 100) break;
  }
  return out.reverse();
}

export const signalOf = (extra: unknown): AbortSignal =>
  (extra as { signal?: AbortSignal } | undefined)?.signal ?? new AbortController().signal;
