import { ChannelType, ThreadAutoArchiveDuration, type Message, type SendableChannels } from 'discord.js';
import { isUndercover } from '../config.ts';
import { log, errorText } from '../log.ts';
import { oneLine } from './chunk.ts';

/** Where a task talks: normally a thread the bot opens on the owner's message. */
export type Venue = {
  channel: SendableChannels;
  threadId: string;
  /** Bot-made thread or DM: every owner message there is for the bot, no mention needed. */
  ownThread: boolean;
};

export function titleFrom(request: string): string {
  const text = oneLine(request.replace(/@me\b/g, ''), 90);
  return text || 'Request';
}

export async function openVenue(message: Message, title: string): Promise<Venue> {
  const ch = message.channel;
  if (ch.type === ChannelType.DM) return { channel: ch, threadId: ch.id, ownThread: true };
  if (ch.isThread()) return { channel: ch, threadId: ch.id, ownThread: false };

  if (ch.type === ChannelType.GuildText && isUndercover(message.guildId)) {
    try {
      // Not on the message: only the owner who asked (and the server's admins) can see it.
      const thread = await ch.threads.create({
        name: `🛠 ${title}`.slice(0, 100), type: ChannelType.PrivateThread, invitable: false,
        autoArchiveDuration: ThreadAutoArchiveDuration.OneDay,
      });
      await thread.members.add(message.author.id);
      return { channel: thread, threadId: thread.id, ownThread: true };
    } catch (err) {
      log.warn('could not open a private thread, using a public one', errorText(err));
    }
  }
  if (ch.type === ChannelType.GuildText || ch.type === ChannelType.GuildAnnouncement) {
    try {
      const thread = message.hasThread && message.thread
        ? message.thread
        : await message.startThread({ name: `🛠 ${title}`.slice(0, 100), autoArchiveDuration: ThreadAutoArchiveDuration.OneDay });
      return { channel: thread, threadId: thread.id, ownThread: true };
    } catch (err) {
      log.warn('could not open a thread, answering in the channel', errorText(err));
    }
  }
  if (!ch.isSendable()) throw new Error('cannot send messages in this channel');
  return { channel: ch, threadId: ch.id, ownThread: false };
}
