import type { Message } from 'discord.js';
import { isUndercover } from '../config.ts';

export type Outcome = 'done' | 'stopped' | 'failed';

export const MARK: Record<Outcome, string> = { done: '✅', stopped: '⏹️', failed: '❌' };

/** The first finished turn of a task started in a channel replies on the owner's message there, pointing at the thread. */
export async function answerOrigin(origin: Message, threadId: string, ownThread: boolean, outcome: Outcome): Promise<void> {
  if (!ownThread || origin.channel.id === threadId || isUndercover(origin.guildId)) return;
  const words = outcome === 'done' ? 'Finished — the summary is in' : outcome === 'stopped' ? 'Stopped — see' : 'Ran into trouble — see';
  await origin.reply({ content: `${MARK[outcome]} ${words} <#${threadId}>.`, allowedMentions: { repliedUser: false } }).catch(() => undefined);
}
