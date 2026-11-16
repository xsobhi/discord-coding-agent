import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, type Message, type SendableChannels } from 'discord.js';
import { redact } from '../discord/redact.ts';
import { postSafe } from '../discord/send.ts';
import { log, errorText } from '../log.ts';

export type Phase = 'working' | 'waiting' | 'done' | 'stopped' | 'failed';

const LOOK: Record<Phase, { title: string; color: number }> = {
  working: { title: '🛠️ Working', color: 0x5865f2 },
  waiting: { title: '⏸️ Waiting for an owner', color: 0xfee75c },
  done: { title: '✅ Done', color: 0x57f287 },
  stopped: { title: '⏹️ Stopped', color: 0x99aab5 },
  failed: { title: '❌ Failed', color: 0xed4245 },
};
const KEEP = 12;
const EDIT_EVERY_MS = 4000;
/** A quick text-only reply never gets a board; anything longer or with actions does. */
const REVEAL_AFTER_MS = 20_000;

export const stopButtonId = (threadId: string): string => `stop:${threadId}`;

/** What the agent is doing right now, for the note on a queued message. */
export type Step = { phase: Phase; line?: string; since: number };

/**
 * One embed per turn, edited in place: phase, recent actions and a Stop button.
 * It is posted at the first action or wait (or after 20 s), not for a quick reply.
 */
export class StatusBoard {
  private message?: Message;
  private posting?: Promise<void>;
  private revealTimer?: NodeJS.Timeout;
  private last: { line?: string; at: number } = { at: Date.now() };
  private lines: string[] = [];
  private actions = 0;
  private phase: Phase = 'working';
  private note = '';
  private readonly startedAt = Math.floor(Date.now() / 1000);
  private timer?: NodeJS.Timeout;
  private lastEdit = 0;
  private closed = false;
  private readonly channel: SendableChannels;
  private readonly threadId: string;
  footer = '';

  constructor(channel: SendableChannels, threadId: string) {
    this.channel = channel;
    this.threadId = threadId;
  }

  open(): void {
    this.revealTimer = setTimeout(() => void this.reveal(), REVEAL_AFTER_MS);
  }

  action(line: string): void {
    this.actions++;
    this.last = { line: redact(line), at: Date.now() };
    this.push(line);
  }

  step(): Step {
    return { phase: this.phase, line: this.last.line, since: this.last.at };
  }

  push(line: string): void {
    this.lines.push(redact(line));
    if (this.lines.length > KEEP) this.lines.splice(0, this.lines.length - KEEP);
    this.schedule();
  }

  setPhase(phase: Phase, note = ''): void {
    this.phase = phase;
    this.note = note;
    if (phase === 'waiting') this.last = { line: note, at: Date.now() };
    this.schedule();
  }

  /** Final state for this turn; the board stops updating and loses its button. Never posted if nothing happened. */
  async finish(phase: Phase, note = ''): Promise<void> {
    if (this.closed) return;
    this.phase = phase;
    this.note = note;
    this.closed = true;
    if (this.timer) clearTimeout(this.timer);
    if (this.revealTimer) clearTimeout(this.revealTimer);
    if (!this.posting) return;
    await this.posting;
    await this.edit();
  }

  private reveal(): Promise<void> {
    if (this.revealTimer) clearTimeout(this.revealTimer);
    this.posting ??= postSafe(this.channel, this.render()).then((m) => {
      this.message = m;
      this.lastEdit = Date.now();
    });
    return this.posting;
  }

  private schedule(): void {
    if (this.closed) return;
    // Changes made while it was being posted show at the next throttled edit.
    if (!this.posting) {
      void this.reveal().then(() => this.schedule());
      return;
    }
    if (this.timer) return;
    const wait = Math.max(0, this.lastEdit + EDIT_EVERY_MS - Date.now());
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.edit();
    }, wait);
  }

  private async edit(): Promise<void> {
    if (!this.message) return;
    this.lastEdit = Date.now();
    try {
      await this.message.edit(this.render());
    } catch (err) {
      log.warn('status edit failed', errorText(err));
    }
  }

  private render() {
    const look = LOOK[this.phase];
    const live = this.phase === 'working' || this.phase === 'waiting';
    const head = `${live ? 'Started' : 'Ran from'} <t:${this.startedAt}:R>${live ? '' : ` to <t:${Math.floor(Date.now() / 1000)}:t>`} · ${this.actions} actions`;
    const body = [head, this.note ? `**${redact(this.note)}**` : '', this.lines.join('\n')].filter(Boolean).join('\n\n');
    const embed = new EmbedBuilder().setTitle(look.title).setColor(look.color).setDescription(body.slice(0, 4000));
    if (this.footer) embed.setFooter({ text: this.footer });
    const stop = new ButtonBuilder().setCustomId(stopButtonId(this.threadId)).setLabel('Stop').setStyle(ButtonStyle.Danger);
    const components = live ? [new ActionRowBuilder<ButtonBuilder>().addComponents(stop)] : [];
    return { embeds: [embed], components };
  }
}
