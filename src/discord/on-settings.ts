import {
  MessageFlags, type ButtonInteraction, type ChatInputCommandInteraction, type Client, type StringSelectMenuInteraction,
} from 'discord.js';
import { isOwner } from '../config.ts';
import { findModel, fitEffort, listModels } from '../engines/catalog.ts';
import { getDefaults, setDefaults } from '../engines/settings.ts';
import { ENGINES, type AgentSettings, type Engine } from '../engines/types.ts';
import { errorText, log } from '../log.ts';
import { hasTask, taskIn } from '../tasks/registry.ts';
import type { Task } from '../tasks/task.ts';
import { renderPanel, type Focus, type Scope } from './settings-panel.ts';

const DENIED = "Only the bot's owners can change its settings.";

/** /model, /effort, /engine: inside a task's thread they change that task, elsewhere the defaults. */
export async function onSettingsCommand(client: Client, interaction: ChatInputCommandInteraction, focus: Focus): Promise<void> {
  if (!isOwner(interaction.user.id)) {
    await interaction.reply({ content: DENIED, flags: MessageFlags.Ephemeral });
    return;
  }
  // Listing models can take a moment on a cold cache; Discord allows 3 seconds before a reply.
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const channelId = interaction.channelId;
  const task = hasTask(channelId) ? await taskIn(client, channelId) : undefined;
  await interaction.editReply(await panelFor(task ? task.record.threadId : 'd', focus, task));
}

/** Panel controls: `cfg:<scope>:<focus>:<kind>[:<value>]`. */
export async function onSettingsComponent(client: Client, interaction: ButtonInteraction | StringSelectMenuInteraction, parts: string[]): Promise<void> {
  if (!isOwner(interaction.user.id)) {
    await interaction.reply({ content: DENIED, flags: MessageFlags.Ephemeral });
    return;
  }
  const [scope = 'd', focus = 'model', kind = '', value = ''] = parts;
  await interaction.deferUpdate();
  const task = scope === 'd' ? undefined : await taskIn(client, scope);
  if (scope !== 'd' && !task) {
    await interaction.editReply({ content: 'That task is closed, so its settings can no longer change.', embeds: [], components: [] });
    return;
  }
  const picked = interaction.isStringSelectMenu() ? interaction.values[0] ?? '' : value;
  try {
    const next = await change(task ? task.record.agent : getDefaults(), kind, picked);
    if (task) task.applySettings(next);
    else setDefaults(next);
    log.info(`settings (${scope === 'd' ? 'defaults' : `task ${task?.record.id}`}) by ${interaction.user.username}: ${next.engine} ${next[next.engine].model} ${next[next.engine].effort ?? ''}`);
  } catch (err) {
    log.warn('settings change failed', errorText(err));
  }
  await interaction.editReply(await panelFor(scope, focus as Focus, task));
}

async function panelFor(scope: Scope, focus: Focus, task: Task | undefined) {
  const settings = task ? task.record.agent : getDefaults();
  return renderPanel({
    scope,
    focus,
    settings,
    taskTitle: task?.record.title,
    busyOn: task?.busy ? task.record.lastEngine : undefined,
    lastEngine: task?.record.lastEngine,
  });
}

/** One click's worth of change. A model that cannot do the current effort gets its own default. */
async function change(current: AgentSettings, kind: string, value: string): Promise<AgentSettings> {
  const next = structuredClone(current);
  if (kind === 'eng' && ENGINES.includes(value as Engine)) next.engine = value as Engine;
  const engine = next.engine;
  if (kind === 'mod' && value) next[engine].model = value;
  if ((kind === 'eff' || kind === 'effsel') && value) next[engine].effort = value;
  const model = findModel(await listModels(engine), next[engine].model);
  next[engine].effort = fitEffort(model, next[engine].effort);
  return next;
}
