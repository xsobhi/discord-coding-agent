import type { Message, MessageCreateOptions, SendableChannels } from 'discord.js';
import { chunk } from './chunk.ts';
import { redact } from './redact.ts';
import { log, errorText } from '../log.ts';

/** Never ping anyone from model-written text (no @everyone, no role pings). */
export const NO_PINGS = { parse: [] as never[] };

/** Posts model-written text: redacted, split to fit, no pings. Returns the last message. */
export async function postText(channel: SendableChannels, text: string): Promise<Message | undefined> {
  let last: Message | undefined;
  for (const piece of chunk(redact(text))) {
    try {
      last = await channel.send({ content: piece, allowedMentions: NO_PINGS });
    } catch (err) {
      log.warn('send failed', errorText(err));
    }
  }
  return last;
}

/** Pings one owner on a bot-written message (a question or approval waiting on them), nobody else. */
export const pingOwner = (userId: string | undefined): MessageCreateOptions =>
  userId ? { content: `<@${userId}>`, allowedMentions: { parse: [], users: [userId] } } : {};

export async function postSafe(channel: SendableChannels, options: MessageCreateOptions): Promise<Message | undefined> {
  try {
    return await channel.send({ allowedMentions: NO_PINGS, ...options });
  } catch (err) {
    log.warn('send failed', errorText(err));
    return undefined;
  }
}

export async function react(message: Message, emoji: string, remove?: string): Promise<void> {
  try {
    if (remove) await message.reactions.cache.get(remove)?.users.remove(message.client.user.id);
    await message.react(emoji);
  } catch {
    // Missing Add Reactions permission is not worth failing a task over.
  }
}
