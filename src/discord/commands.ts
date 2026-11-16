import { ApplicationIntegrationType, InteractionContextType, SlashCommandBuilder, type Client } from 'discord.js';
import { errorText, log } from '../log.ts';
import type { Focus } from './settings-panel.ts';

/**
 * No options on purpose: each command answers with a panel (a select menu plus
 * buttons) built from what the chosen engine actually offers.
 */
const COMMANDS: { name: Focus; description: string }[] = [
  { name: 'model', description: 'Choose the model the agent uses (here: this task; elsewhere: new tasks)' },
  { name: 'effort', description: 'Choose how hard the agent thinks (here: this task; elsewhere: new tasks)' },
  { name: 'engine', description: 'Switch the agent between Claude Code and Codex' },
];

export const isSettingsCommand = (name: string): name is Focus => COMMANDS.some((c) => c.name === name);

export async function registerCommands(client: Client<true>): Promise<void> {
  const body = COMMANDS.map((c) => new SlashCommandBuilder().setName(c.name).setDescription(c.description)
    .setContexts(InteractionContextType.Guild, InteractionContextType.BotDM)
    .setIntegrationTypes(ApplicationIntegrationType.GuildInstall)
    .toJSON());
  try {
    await client.application.commands.set(body);
    log.info(`slash commands registered: ${COMMANDS.map((c) => `/${c.name}`).join(' ')}`);
  } catch (err) {
    log.error('could not register slash commands', errorText(err));
  }
}
