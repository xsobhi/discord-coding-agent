import { ChannelType, type Client, type Message } from 'discord.js';
import { isGuest, isOwner, isUndercover } from '../config.ts';
import { answerTyped } from '../agent/questions.ts';
import { hasTask, retire, taskIn } from '../tasks/registry.ts';
import { continueTask, startTask } from '../tasks/start.ts';
import type { Task } from '../tasks/task.ts';
import { followedTask, isOpenChannel, mentionsMe, noteRequest } from './addressing.ts';
import { resolveMentions } from './describe.ts';
import { react } from './send.ts';

const refusedAt = new Map<string, number>();

/**
 * Owners start a task by mentioning the bot, DMing it, or writing anything in
 * an open channel. In the thread the bot opens, every owner message goes to
 * that task. Guests do the same, but only reach tasks they started. Other
 * people's messages are never instructions; the bot only reads them as context.
 */
export async function onMessage(client: Client, message: Message): Promise<void> {
  if (message.author.bot || message.webhookId || message.system) return;
  const owner = isOwner(message.author.id);
  // Guests start tasks like owners do, but only ever reach their own (they run sandboxed: see guests/guest.ts).
  const guest = isGuest(message.author.id);
  const isDM = message.channel.type === ChannelType.DM;
  const open = isOpenChannel(message);
  const mentioned = mentionsMe(message);
  const repliedToMe = message.mentions.repliedUser?.id === client.user!.id;

  if (hasTask(message.channel.id)) {
    const task = await taskIn(client, message.channel.id);
    if (task) {
      if (!owner && !(guest && task.record.ownerId === message.author.id)) return;
      if (!task.record.ownThread && !mentioned && !repliedToMe && !open) return;
      // A fresh request in a borrowed channel while idle is a new task, not a follow-up.
      const newRequest = !task.record.ownThread && (mentioned || open) && !repliedToMe && !task.busy;
      if (!newRequest) return inTask(task, message, isDM);
    }
  } else if ((owner || guest) && !isDM && !message.channel.isThread()) {
    const followed = await followedTask(message, mentioned || open);
    const task = followed ? await taskIn(client, followed.threadId) : undefined;
    if (task && followed && (owner || task.record.ownerId === message.author.id)) return inTask(task, message, false, followed.via);
  }

  if (!mentioned && !isDM && !open) return;
  // In an open channel other people talk freely; only asking the bot by name gets them the refusal.
  if (!owner && !guest) return mentioned || isDM ? refuse(message) : undefined;
  const task = await startTask(client, message);
  if (task) noteRequest(message, task.record.threadId);
}

/** An owner message for an existing task; `via` says how a channel message was matched to it. */
async function inTask(task: Task, message: Message, isDM: boolean, via?: string): Promise<void> {
  const word = message.content.replace(/<@[!&]?\d+>/g, '').trim().toLowerCase();
  if (word === 'stop') {
    const stopped = await task.stop(message.author.username);
    await react(message, stopped ? '⏹️' : '🤷');
    return;
  }
  if (isDM && word === 'new') {
    retire(message.channel.id);
    await message.reply('Fresh start — my next message here begins a new task.').catch(() => undefined);
    return;
  }
  if (answerTyped(task.record.threadId, resolveMentions(message), message.author.username, message.reference?.messageId)) {
    await react(message, '✅');
    return;
  }
  await continueTask(task, message, via);
}

async function refuse(message: Message): Promise<void> {
  if (isUndercover(message.guildId)) return;
  const last = refusedAt.get(message.author.id) ?? 0;
  if (Date.now() - last < 10 * 60_000) return;
  refusedAt.set(message.author.id, Date.now());
  await message.reply({
    content: 'I only take instructions from my owners — they can ask me to look into this.',
    allowedMentions: { repliedUser: false },
  }).catch(() => undefined);
}
