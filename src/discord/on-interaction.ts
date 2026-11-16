import { MessageFlags, type Client, type Interaction } from 'discord.js';
import { isGuest, isOwner } from '../config.ts';
import { onApprovalButton, type Verdict } from '../agent/approvals.ts';
import { onQuestionButton, onQuestionMenu, onQuestionWhy, onQuestionWhySent } from '../agent/questions.ts';
import { hasTask, taskIn } from '../tasks/registry.ts';
import { isSettingsCommand } from './commands.ts';
import { onSettingsCommand, onSettingsComponent } from './on-settings.ts';

const KINDS = new Set(['stop', 'read', 'ap', 'q', 'qs', 'qw', 'qm']);

/**
 * Slash commands, plus the Stop, Read now, approval, question and settings controls. Owners only, except that a
 * guest may answer questions, Stop and Read now in a task of their own (never approvals or settings).
 */
export async function onInteraction(client: Client, interaction: Interaction): Promise<void> {
  if (interaction.isChatInputCommand()) {
    if (isSettingsCommand(interaction.commandName)) await onSettingsCommand(client, interaction, interaction.commandName);
    return;
  }
  if (!interaction.isButton() && !interaction.isStringSelectMenu() && !interaction.isModalSubmit()) return;
  const [kind = '', a = '', b = '', c = ''] = interaction.customId.split(':');
  if (kind === 'cfg') return interaction.isModalSubmit() ? undefined : onSettingsComponent(client, interaction, interaction.customId.split(':').slice(1));
  if (!KINDS.has(kind)) return;
  const guestMay = kind === 'q' || kind === 'qs' || kind === 'qw' || kind === 'qm' || ((kind === 'stop' || kind === 'read') && a === interaction.channelId);
  if (!isOwner(interaction.user.id) && !(guestMay && await ownTaskHere(client, interaction.channelId, interaction.user.id))) {
    await interaction.reply({ content: "Only the bot's owners can use these.", flags: MessageFlags.Ephemeral });
    return;
  }

  if (interaction.isStringSelectMenu()) {
    if (kind === 'qs') await onQuestionMenu(interaction, a, Number(b));
    return;
  }
  if (interaction.isModalSubmit()) {
    if (kind === 'qm') await onQuestionWhySent(interaction, a, Number(b), Number(c));
    return;
  }
  if (kind === 'qw') return onQuestionWhy(interaction, a, Number(b), Number(c));
  if (kind === 'ap') return onApprovalButton(interaction, a, b as Verdict);
  if (kind === 'q') return onQuestionButton(interaction, a, Number(b), Number(c));
  if (kind === 'read') {
    const task = await taskIn(client, a);
    if (!task?.busy || !task.inbox.waiting) {
      await interaction.reply({ content: 'Already read.', flags: MessageFlags.Ephemeral });
      return;
    }
    await interaction.deferUpdate();
    await task.readNow(interaction.user.username);
    return;
  }
  if (kind === 'stop') {
    const task = await taskIn(client, a);
    if (!task?.busy) {
      await interaction.reply({ content: 'Nothing is running there.', flags: MessageFlags.Ephemeral });
      return;
    }
    // Acknowledge first: Discord gives a button 3 seconds, an interrupt can take longer.
    await interaction.deferUpdate();
    await task.stop(interaction.user.username);
  }
}

/** The person started the task living in this channel (a guest's own thread or DM). */
async function ownTaskHere(client: Client, channelId: string | null, userId: string): Promise<boolean> {
  if (!channelId || !isGuest(userId) || !hasTask(channelId)) return false;
  return (await taskIn(client, channelId))?.record.ownerId === userId;
}
