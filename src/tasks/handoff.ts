import type { SendableChannels, TextBasedChannel } from 'discord.js';
import { describe } from '../discord/describe.ts';
import { ENGINE_LABEL, type Engine } from '../engines/types.ts';
import { fetchHistory } from '../mcp/util.ts';

/**
 * When a task changes engine, the new one has not seen what the old one did.
 * The thread itself is the record: the owners' messages and the bot's posts.
 */
export async function handoffContext(channel: SendableChannels, from: Engine, to: Engine): Promise<string[]> {
  try {
    const history = await fetchHistory(channel as TextBasedChannel, 60);
    const lines = history.filter((m) => m.content.trim()).map((m) => describe(m, 1500));
    if (!lines.length) return [];
    return [`This task's Discord thread so far (oldest first). Earlier turns were handled by ${ENGINE_LABEL[from]}; the bot's own posts are its words. You are ${ENGINE_LABEL[to]}, taking over from here:\n\n${lines.join('\n\n')}`];
  } catch {
    return [];
  }
}
