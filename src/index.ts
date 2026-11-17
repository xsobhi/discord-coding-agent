import { Events } from 'discord.js';
import { config } from './config.ts';
import { createClient, inviteUrl } from './discord/client.ts';
import { onInteraction } from './discord/on-interaction.ts';
import { onMessage } from './discord/on-message.ts';
import { refreshKnownSecrets } from './discord/redact.ts';
import { errorText, log } from './log.ts';
import { flushStore, loadStore } from './store.ts';
import { warmCatalog } from './engines/catalog.ts';
import { loadSettings } from './engines/settings.ts';
import { registerCommands } from './discord/commands.ts';
import { setOwnerLabels, setShutdown, trackActivity } from './tasks/lifecycle.ts';
import { noticeInterrupted, shutdownAll } from './tasks/registry.ts';
import { startGuestCleanup } from './guests/cleanup.ts';
import { startScheduledWakes } from './tasks/scheduled-wake.ts';
import { acquireInstance } from './runtime/single-instance.ts';

// Acquire before loading/writing shared task state or connecting to Discord.
const instance = await acquireInstance(config.clientId);

// mcp__discord is allow-listed on purpose (send_message gates itself), so this warning is expected.
process.removeAllListeners('warning');
process.on('warning', (w: Error & { code?: string }) => {
  if (w.code !== 'CLAUDE_SDK_CAN_USE_TOOL_SHADOWED') log.warn(w.name, w.message);
});

// Settings first: old task records borrow the defaults when they are migrated.
loadSettings();
loadStore();
await refreshKnownSecrets(config.secretScanDirs);
setInterval(() => void refreshKnownSecrets(config.secretScanDirs), 10 * 60_000).unref();

const client = createClient();

client.once(Events.ClientReady, async (ready) => {
  instance.ready();
  log.info(`logged in as ${ready.user.tag}; owners ${[...config.owners].join(', ')}`);
  const labels: string[] = [];
  for (const id of config.owners) {
    const user = await ready.users.fetch(id).catch(() => null);
    labels.push(user ? `${user.globalName ?? user.username} (@${user.username}, id ${id})` : `id ${id}`);
  }
  setOwnerLabels(labels);
  const guilds = ready.guilds.cache.map((g) => `${g.name} (${g.id})`);
  log.info(`in ${guilds.length} servers: ${guilds.join(', ') || 'none'}`);
  if (!guilds.length) log.info(`invite: ${inviteUrl(config.clientId)}`);
  await registerCommands(ready);
  warmCatalog();
  await noticeInterrupted(client);
  startScheduledWakes(client);
  startGuestCleanup();
});

client.on(Events.MessageCreate, (message) => {
  trackActivity(() => onMessage(client, message)).catch((err) => log.error('message handler', errorText(err)));
});

client.on(Events.InteractionCreate, (interaction) => {
  trackActivity(() => onInteraction(client, interaction)).catch((err) => log.error('interaction handler', errorText(err)));
});

client.on(Events.Error, (err) => log.error('discord client', errorText(err)));

let closing = false;
const shutdown = async (reason: string): Promise<void> => {
  if (closing) return;
  closing = true;
  log.info(`${reason}: closing sessions`);
  // Closing waits for each engine process to really exit (so a restart can resume its conversation);
  // the supervisor's kill timeout is 8 seconds, so give up a little before it.
  setTimeout(() => process.exit(1), 7000).unref();
  await shutdownAll();
  flushStore();
  await client.destroy();
  await instance.close().catch(() => undefined);
  process.exit(0);
};
setShutdown(shutdown);
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
// Windows has no SIGTERM for PM2 to send: with `shutdown_with_message` it sends this message instead.
process.on('message', (message) => { if (message === 'shutdown') void shutdown('PM2 shutdown'); });
process.on('unhandledRejection', (err) => log.error('unhandled rejection', errorText(err)));

await client.login(config.token);
