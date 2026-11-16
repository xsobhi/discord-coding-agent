import { randomUUID } from 'node:crypto';
import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, MessageFlags, ModalBuilder, StringSelectMenuBuilder, TextInputBuilder, TextInputStyle,
  type ButtonInteraction, type Message, type ModalSubmitInteraction, type SendableChannels, type StringSelectMenuInteraction,
} from 'discord.js';
import { config } from '../config.ts';
import { clip } from '../discord/chunk.ts';
import { pingOwner, postSafe } from '../discord/send.ts';

type Option = { label: string; description?: string };
/** `why`: a press opens a box for the owner's reason, optional (ask_pick). */
type Question = { question: string; header?: string; options: Option[]; multiSelect?: boolean; why?: boolean };
type Open = {
  questions: Question[]; answers: (string | undefined)[]; messages: Message[]; done: () => void;
  /** An owner wrote something that is not an answer: close the set and hand Claude the message. */
  interrupt: (by: string, text: string) => void;
};

const open = new Map<string, Open>();
/** Thread id → question set waiting there, so a typed reply can answer it. */
const byThread = new Map<string, string>();

/**
 * Shows Claude's AskUserQuestion as buttons (or a menu for multi-select),
 * pinging `ping` on the first, and waits. Resolves to `{ question: answer }`,
 * or null on timeout/stop.
 */
export async function askQuestions(channel: SendableChannels, threadId: string, questions: Question[], signal: AbortSignal, ping?: string):
  Promise<Record<string, string> | null> {
  const id = randomUUID().slice(0, 8);
  const entry: Open = { questions, answers: questions.map(() => undefined), messages: [], done: () => undefined, interrupt: () => undefined };
  for (const [qi, q] of questions.entries()) {
    const message = await postSafe(channel, { ...(qi === 0 ? pingOwner(ping) : {}), ...render(id, qi, q, questions.length > 1) });
    if (message) entry.messages.push(message);
  }
  if (!entry.messages.length || signal.aborted) return null;

  return new Promise((resolve) => {
    const finish = (result: Record<string, string> | null, why = ''): void => {
      if (!open.delete(id)) return;
      if (byThread.get(threadId) === id) byThread.delete(threadId);
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
      entry.messages.forEach((m, qi) => {
        const unanswered = entry.answers[qi] === undefined;
        void m.edit({ ...(unanswered ? { content: why } : {}), components: [] }).catch(() => undefined);
      });
      resolve(result);
    };
    const onAbort = (): void => finish(null, '⏹️ Closed: the task was stopped.');
    const timer = setTimeout(() => finish(null, `⌛ No answer within ${config.approvalMinutes} min, so I carried on without it.`), config.approvalMinutes * 60_000);
    signal.addEventListener('abort', onAbort, { once: true });
    entry.done = () => {
      if (entry.answers.every((a) => a !== undefined)) {
        finish(Object.fromEntries(questions.map((q, i) => [q.question, entry.answers[i] as string])));
      }
    };
    entry.interrupt = (by, text) => {
      const instead = `(no answer: ${by} wrote "${clip(text, 600)}" instead of picking - read it, then ask again if still needed)`;
      finish(Object.fromEntries(questions.map((q, i) => [q.question, entry.answers[i] ?? instead])),
        `💬 Closed: ${by} wrote a message instead, so I read that first and ask again if needed.`);
    };
    open.set(id, entry);
    byThread.set(threadId, id);
  });
}

function render(id: string, qi: number, q: Question, many: boolean) {
  const lines = q.options.map((o) => `• **${o.label}**${o.description ? ` — ${o.description}` : ''}`);
  // With several questions open, a typed answer must be a Discord reply to its question (answerTyped).
  const own = many ? '*Or reply to this message with your own answer.*' : '*Or type your own answer in this thread.*';
  const embed = new EmbedBuilder().setColor(0xfee75c).setTitle(`❓ ${clip(q.question, 240)}`)
    .setDescription(clip(`${lines.join('\n')}\n\n${own}`, 4000))
    .setFooter({ text: q.header ? `${q.header} · owners only` : 'owners only' });
  if (!q.options.length) {
    // A free-text question: the owner types the answer.
    return { embeds: [embed.setDescription(many ? '*Reply to this message with your answer.*' : '*Type your answer in this thread.*')], components: [] };
  }
  if (q.multiSelect) {
    const menu = new StringSelectMenuBuilder().setCustomId(`qs:${id}:${qi}`).setPlaceholder('Pick one or more')
      .setMinValues(1).setMaxValues(q.options.length)
      .addOptions(q.options.map((o, oi) => ({ label: clip(o.label, 100), value: String(oi), description: o.description ? clip(o.description, 100) : undefined })));
    return { embeds: [embed], components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu)] };
  }
  // Every option its own button (ask_pick sends up to 25), five a row.
  const buttons = q.options.slice(0, 25).map((o, oi) =>
    new ButtonBuilder().setCustomId(`${q.why ? 'qw' : 'q'}:${id}:${qi}:${oi}`).setLabel(clip(o.label, 80)).setStyle(ButtonStyle.Secondary));
  const rows = Array.from({ length: Math.ceil(buttons.length / 5) }, (_, r) =>
    new ActionRowBuilder<ButtonBuilder>().addComponents(buttons.slice(r * 5, r * 5 + 5)));
  return { embeds: [embed], components: rows };
}

export async function onQuestionButton(interaction: ButtonInteraction, id: string, qi: number, oi: number): Promise<void> {
  const entry = open.get(id);
  const label = entry?.questions[qi]?.options[oi]?.label;
  if (!entry || label === undefined) {
    await interaction.reply({ content: 'That question is already closed.', flags: MessageFlags.Ephemeral });
    return;
  }
  await record(interaction, entry, qi, label);
}

/** A press on a `why` question: a box for the reason (optional); the pick counts when it is sent. */
export async function onQuestionWhy(interaction: ButtonInteraction, id: string, qi: number, oi: number): Promise<void> {
  const label = open.get(id)?.questions[qi]?.options[oi]?.label;
  if (label === undefined) {
    await interaction.reply({ content: 'That question is already closed.', flags: MessageFlags.Ephemeral });
    return;
  }
  const why = new TextInputBuilder().setCustomId('why').setLabel('Why this one? (optional, it learns from it)')
    .setStyle(TextInputStyle.Paragraph).setRequired(false).setMaxLength(500);
  await interaction.showModal(new ModalBuilder().setCustomId(`qm:${id}:${qi}:${oi}`).setTitle(clip(`You picked ${label}`, 45))
    .addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(why)));
}

export async function onQuestionWhySent(interaction: ModalSubmitInteraction, id: string, qi: number, oi: number): Promise<void> {
  const entry = open.get(id);
  const label = entry?.questions[qi]?.options[oi]?.label;
  if (!entry || label === undefined || !interaction.isFromMessage()) {
    await interaction.reply({ content: 'That question is already closed.', flags: MessageFlags.Ephemeral });
    return;
  }
  const why = interaction.fields.getTextInputValue('why').trim();
  entry.answers[qi] = why ? `${label} (why: ${why})` : label;
  await interaction.update({ content: `**${interaction.user.username}:** ${clip(entry.answers[qi] as string, 300)}`, components: [] }).catch(() => undefined);
  entry.done();
}

export async function onQuestionMenu(interaction: StringSelectMenuInteraction, id: string, qi: number): Promise<void> {
  const entry = open.get(id);
  if (!entry) {
    await interaction.reply({ content: 'That question is already closed.', flags: MessageFlags.Ephemeral });
    return;
  }
  const labels = interaction.values.map((v) => entry.questions[qi]?.options[Number(v)]?.label).filter(Boolean);
  await record(interaction, entry, qi, labels.join(', '));
}

async function record(interaction: ButtonInteraction | StringSelectMenuInteraction, entry: Open, qi: number, answer: string): Promise<void> {
  entry.answers[qi] = answer;
  await interaction.update({ content: `**${interaction.user.username}:** ${answer}`, components: [] }).catch(() => undefined);
  entry.done();
}

/**
 * A typed owner message while questions wait in its thread (a reply used to go to the
 * first open question, so "what is this thing you are sending me" was taken as an answer). A Discord reply to
 * a question answers that one; a plain message answers the only question left open; anything else
 * closes the set and reaches Claude as what the owner wrote, so it can explain or ask again.
 * True if the message was used here.
 */
export function answerTyped(threadId: string, text: string, by = 'typed', replyTo?: string): boolean {
  const id = byThread.get(threadId);
  const entry = id ? open.get(id) : undefined;
  if (!entry) return false;
  const replied = replyTo ? entry.messages.findIndex((m) => m.id === replyTo) : -1;
  const left = entry.answers.flatMap((a, qi) => (a === undefined ? [qi] : []));
  const qi = replied >= 0 ? replied : !replyTo && left.length === 1 ? left[0] : -1;
  if (qi === undefined || qi < 0) {
    entry.interrupt(by, text);
    return true;
  }
  entry.answers[qi] = text;
  void entry.messages[qi]?.edit({ content: `**${by}:** ${clip(text, 300)}`, components: [] }).catch(() => undefined);
  entry.done();
  return true;
}
