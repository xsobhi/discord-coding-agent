import { ChannelType, type Message } from 'discord.js';
import { config } from '../config.ts';
import { mentionsMe } from './addressing.ts';
import { log, errorText } from '../log.ts';
import { saveAttachments } from './attachments.ts';
import { describe, resolveMentions, where, who } from './describe.ts';
import { transcribeAll, type Transcript } from './transcribe.ts';

export type RequestContext = {
  request: string;
  owner: string;
  where: string;
  link: string;
  /** The message the owner replied to — usually whoever has the problem. */
  replyTo?: string;
  threadStarter?: string;
  mentioned: string[];
  recent: string;
  attachments: string[];
  /** The owner's own voice notes and recordings, transcribed: their words. */
  voice: Transcript[];
  /** Written in an open channel without naming the bot: maybe not meant for it at all. */
  unaddressed: boolean;
};

export async function gatherContext(message: Message, taskId: string): Promise<RequestContext> {
  const own = await saveAttachments(message, taskId);
  const voice = transcribeAll(own); // the slow part: runs while the rest is fetched
  const replied = await fetchReplied(message);
  const theirs = replied ? await saveAttachments(replied, taskId) : [];
  const [heard, theirHeard, threadStarter, mentioned, recent] = await Promise.all([
    voice, transcribeAll(theirs), starter(message), mentionedPeople(message), recentMessages(message, config.contextMessages),
  ]);
  return {
    request: resolveMentions(message).trim(),
    owner: who(message.author, message.member),
    where: where(message),
    link: message.url,
    // Whoever wrote the replied-to message, its audio is context, never the owner's instruction.
    replyTo: replied ? describe(replied, 3000) + theirHeard.map(heardLine).join('') : undefined,
    threadStarter,
    mentioned,
    recent,
    attachments: [...own, ...theirs],
    voice: heard,
    unaddressed: message.channel.type !== ChannelType.DM && !mentionsMe(message),
  };
}

export const heardLine = (t: Transcript): string =>
  `\n  [transcript of ${t.path.split('/').pop()} (${t.note}): ${t.text ? JSON.stringify(t.text) : '(no speech)'}]`;

async function fetchReplied(message: Message): Promise<Message | undefined> {
  if (!message.reference?.messageId) return undefined;
  try {
    return await message.fetchReference();
  } catch {
    return undefined;
  }
}

async function starter(message: Message): Promise<string | undefined> {
  const ch = message.channel;
  if (!ch.isThread()) return undefined;
  try {
    const first = await ch.fetchStarterMessage();
    return first && first.id !== message.id ? describe(first, 2000) : undefined;
  } catch {
    return undefined;
  }
}

async function mentionedPeople(message: Message): Promise<string[]> {
  const out: string[] = [];
  for (const user of message.mentions.users.values()) {
    if (user.id === message.client.user.id) continue;
    const member = message.guild ? await message.guild.members.fetch(user.id).catch(() => null) : null;
    const roles = member ? [...member.roles.cache.values()].filter((r) => r.id !== message.guild?.id).map((r) => r.name) : [];
    out.push(`${who(user, member)}${roles.length ? ` — roles: ${roles.join(', ')}` : ''}`);
  }
  return out;
}

export async function recentMessages(message: Message, count: number): Promise<string> {
  try {
    const batch = await message.channel.messages.fetch({ before: message.id, limit: Math.min(count, 100) });
    const lines = [...batch.values()].reverse().map((m) => describe(m, 1200));
    return lines.length ? lines.join('\n\n') : '(no earlier messages)';
  } catch (err) {
    log.warn('context fetch failed', errorText(err));
    return `(could not read history: ${errorText(err)})`;
  }
}
