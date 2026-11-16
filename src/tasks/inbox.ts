import { ActionRowBuilder, ButtonBuilder, ButtonStyle, type Message, type SendableChannels } from 'discord.js';
import { isUndercover } from '../config.ts';
import { postSafe, react } from '../discord/send.ts';
import type { OwnerTurn } from '../engines/types.ts';
import type { StatusBoard } from './status.ts';

/** How long a queued message waits before the bot says so in the thread. */
const NOTICE_AFTER_MS = 45_000;

export const readNowButtonId = (threadId: string): string => `read:${threadId}`;

type Entry = { turn: OwnerTurn; message?: Message };

/**
 * Owner messages on their way to the agent, queued like the CLI's: ⏳ while a
 * running step holds them back, 👀 once the agent has read them, then ✅ (or
 * ⏹️ / ❌) when the turn that read them ends. A message held back for a while
 * gets a note naming the step in the way, with a button to interrupt it.
 */
export class Inbox {
  private readonly unread = new Map<string, Entry>();
  private readThisTurn: Message[] = [];
  /** Each message's reactions run in order, so a late 👀 can't land after its ✅. */
  private readonly marks = new WeakMap<Message, Promise<void>>();
  private notice?: Message;
  private noticeTimer?: NodeJS.Timeout;
  private readonly channel: SendableChannels;
  private readonly threadId: string;
  private readonly board: () => StatusBoard | undefined;

  constructor(channel: SendableChannels, threadId: string, board: () => StatusBoard | undefined) {
    this.channel = channel;
    this.threadId = threadId;
    this.board = board;
  }

  /** A turn handed to the engine; `queued` when the agent is busy and will read it later. */
  received(turn: OwnerTurn, message: Message | undefined, queued: boolean): void {
    this.unread.set(turn.id, { turn, message });
    if (!queued) return;
    if (message) this.mark(message, '⏳');
    this.noticeTimer ??= setTimeout(() => void this.postNotice(), NOTICE_AFTER_MS);
  }

  read(turnId: string): void {
    const entry = this.unread.get(turnId);
    if (!entry) return;
    this.unread.delete(turnId);
    if (entry.message) {
      this.readThisTurn.push(entry.message);
      this.mark(entry.message, '👀', '⏳');
    }
    if (!this.unread.size) void this.clearNotice();
  }

  /** The turn ended: the messages it read get its outcome. */
  settle(mark: string): void {
    for (const message of this.readThisTurn.splice(0)) this.mark(message, mark, '👀');
  }

  get waiting(): number {
    return this.unread.size;
  }

  /** Turns the engine never took in (Codex can drop steered input when interrupted). */
  pending(): OwnerTurn[] {
    return [...this.unread.values()].map((e) => e.turn);
  }

  /** The engine process is gone: what it never read is lost, so say so on each message. */
  dropAll(): void {
    for (const entry of this.unread.values()) if (entry.message) this.mark(entry.message, '⚠️', '⏳');
    this.unread.clear();
    void this.clearNotice();
  }

  /** After "Read now": the note says the step is being interrupted. */
  async interrupting(by: string): Promise<void> {
    await this.notice?.edit({ content: `📥 ${by} asked me to read it now: interrupting the current step…`, components: [] }).catch(() => undefined);
  }

  private mark(message: Message, emoji: string, remove?: string): void {
    // Undercover: the request in the channel stays unmarked; the private thread is the receipt.
    if (message.channelId !== this.threadId && isUndercover(message.guildId)) return;
    const next = (this.marks.get(message) ?? Promise.resolve()).then(() => react(message, emoji, remove));
    this.marks.set(message, next);
  }

  private async postNotice(): Promise<void> {
    this.noticeTimer = undefined;
    const count = this.unread.size;
    if (!count || this.notice) return;
    const what = count === 1 ? 'your message' : `${count} messages`;
    const it = count === 1 ? 'it' : 'them';
    const button = new ButtonBuilder().setCustomId(readNowButtonId(this.threadId))
      .setLabel('Read now (interrupts that step)').setStyle(ButtonStyle.Secondary).setEmoji('⏭️');
    this.notice = await postSafe(this.channel, {
      content: `📥 Got ${what}. ${this.blocker()} I'll read ${it} the moment it ends.`,
      components: [new ActionRowBuilder<ButtonBuilder>().addComponents(button)],
    });
    if (!this.unread.size) await this.clearNotice();
  }

  /** What is keeping the agent from reading, from the status board. */
  private blocker(): string {
    const step = this.board()?.step();
    if (!step) return "I'm partway through a step.";
    const minutes = Math.round((Date.now() - step.since) / 60_000);
    const running = minutes < 1 ? 'under a minute' : `${minutes} min`;
    if (step.phase === 'waiting') return `I'm waiting on the request above (${running} so far).`;
    return step.line ? `My current step has been running for ${running}: ${step.line}.` : "I'm partway through a step.";
  }

  private async clearNotice(): Promise<void> {
    if (this.noticeTimer) clearTimeout(this.noticeTimer);
    this.noticeTimer = undefined;
    const notice = this.notice;
    this.notice = undefined;
    await notice?.delete().catch(() => undefined);
  }
}
