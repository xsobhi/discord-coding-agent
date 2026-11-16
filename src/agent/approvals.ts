import { randomUUID } from 'node:crypto';
import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, MessageFlags,
  type ButtonInteraction, type Message, type SendableChannels,
} from 'discord.js';
import { config } from '../config.ts';
import { clip } from '../discord/chunk.ts';
import { redact } from '../discord/redact.ts';
import { pingOwner, postSafe } from '../discord/send.ts';

export type Verdict = 'once' | 'task' | 'deny';
export type Outcome = { verdict: Verdict; note: string };
export type Ask = { title: string; detail: string; reason?: string; offerTaskWide: boolean };

type Pending = { settle: (o: Outcome) => void };
const pending = new Map<string, Pending>();

/** Posts Approve / Deny buttons in the thread (pinging `ping`) and waits for an owner to press one. */
export async function askOwners(channel: SendableChannels, ask: Ask, signal: AbortSignal, ping?: string): Promise<Outcome> {
  const id = randomUUID().slice(0, 8);
  const lines = [ask.reason ? `**Why I'm asking:** ${clip(redact(ask.reason), 600)}` : '', block(ask.detail)];
  const embed = new EmbedBuilder().setTitle(`🔐 ${clip(ask.title, 240)}`).setColor(0xfee75c)
    .setDescription(lines.filter(Boolean).join('\n\n'))
    .setFooter({ text: `Automatic review could not decide this one. Owners only · times out in ${config.approvalMinutes} min` });
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`ap:${id}:once`).setLabel('Approve').setStyle(ButtonStyle.Success),
    ...(ask.offerTaskWide
      ? [new ButtonBuilder().setCustomId(`ap:${id}:task`).setLabel('Approve for this task').setStyle(ButtonStyle.Primary)]
      : []),
    new ButtonBuilder().setCustomId(`ap:${id}:deny`).setLabel('Deny').setStyle(ButtonStyle.Danger),
  );
  if (signal.aborted) return { verdict: 'deny', note: 'The task was stopped.' };
  const message = await postSafe(channel, { ...pingOwner(ping), embeds: [embed], components: [row] });
  if (!message) return { verdict: 'deny', note: 'Could not post the approval request in Discord.' };

  return new Promise<Outcome>((resolve) => {
    const finish = (o: Outcome, label: string): void => {
      if (!pending.delete(id)) return;
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
      void closeView(message, embed, label);
      resolve(o);
    };
    const onAbort = (): void => finish({ verdict: 'deny', note: 'The task was stopped.' }, 'Cancelled — task stopped');
    const timer = setTimeout(
      () => finish({ verdict: 'deny', note: `No owner answered within ${config.approvalMinutes} minutes.` }, 'Timed out — denied'),
      config.approvalMinutes * 60_000,
    );
    signal.addEventListener('abort', onAbort, { once: true });
    pending.set(id, { settle: (o) => finish(o, o.note) });
  });
}

/** Button handler for `ap:<id>:<verdict>`; the caller has already checked the owner. */
export async function onApprovalButton(interaction: ButtonInteraction, id: string, verdict: Verdict): Promise<void> {
  const entry = pending.get(id);
  if (!entry) {
    await interaction.reply({ content: 'That request is already closed.', flags: MessageFlags.Ephemeral });
    return;
  }
  await interaction.deferUpdate();
  const by = interaction.user.username;
  const note = verdict === 'deny' ? `Denied by ${by}` : verdict === 'task' ? `Approved for this task by ${by}` : `Approved by ${by}`;
  entry.settle({ verdict, note });
}

async function closeView(message: Message, embed: EmbedBuilder, label: string): Promise<void> {
  const done = EmbedBuilder.from(embed).setColor(label.startsWith('Approved') ? 0x57f287 : 0x99aab5).setFooter({ text: label });
  await message.edit({ content: '', embeds: [done], components: [] }).catch(() => undefined);
}

const block = (text: string): string => `\`\`\`\n${clip(redact(text), 3000).replace(/```/g, '`​``')}\n\`\`\``;
