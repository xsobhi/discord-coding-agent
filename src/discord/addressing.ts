import { ChannelType, MessageReferenceType, type Message } from 'discord.js';
import { config } from '../config.ts';
import { hasTask, requestThread } from '../tasks/registry.ts';

/** How soon a second message from the same owner in an open channel still belongs to the request they just made. */
const BURST_MS = 90_000;
const lastRequest = new Map<string, { authorId: string; threadId: string; at: number }>();

export const mentionsMe = (message: Message): boolean => {
  const me = message.client.user.id;
  return message.mentions.users.has(me) || message.mentions.roles.some((r) => r.tags?.botId === me);
};

/** A channel where every owner message is for the bot, mention or not. Its threads keep the usual rule. */
export const isOpenChannel = (message: Message): boolean =>
  message.channel.type !== ChannelType.DM && !message.channel.isThread() && config.openChannels.has(message.channel.id);

/** An owner's message in an open channel started a task: their next quick message joins it. */
export function noteRequest(message: Message, threadId: string): void {
  if (isOpenChannel(message)) lastRequest.set(message.channel.id, { authorId: message.author.id, threadId, at: Date.now() });
}

export type Followed = { threadId: string; via: string };

/**
 * The task an owner's channel message (not one in a thread) belongs to, so it
 * goes there instead of opening a second thread on the same problem: a reply
 * to the request that started a task, a reply to the bot's note about one, or
 * in an open channel a message sent right after the request. Undefined: it is
 * a request of its own.
 */
export async function followedTask(message: Message, addressed: boolean): Promise<Followed | undefined> {
  const ref = message.reference?.type === MessageReferenceType.Default ? message.reference.messageId : undefined;
  if (ref) {
    const started = addressed ? requestThread(ref) : undefined;
    if (started) return { threadId: started, via: 'replying to the request that started this task' };
    if (message.mentions.repliedUser?.id !== message.client.user.id) return undefined;
    const note = await message.fetchReference().catch(() => undefined);
    const origin = note?.reference?.messageId;
    return origin && hasTask(origin) ? { threadId: origin, via: "replying to the bot's note about this task" } : undefined;
  }
  const last = lastRequest.get(message.channel.id);
  if (!last || !isOpenChannel(message) || last.authorId !== message.author.id) return undefined;
  if (Date.now() - last.at > BURST_MS || !hasTask(last.threadId)) return undefined;
  last.at = Date.now();
  return { threadId: last.threadId, via: 'right after their request, so it is part of it' };
}
