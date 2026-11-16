import { Client, GatewayIntentBits, Partials } from 'discord.js';

export function createClient(): Client {
  return new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
      GatewayIntentBits.GuildMembers,
      GatewayIntentBits.DirectMessages,
    ],
    // DMs arrive as partial channels until fetched.
    partials: [Partials.Channel, Partials.Message],
    allowedMentions: { parse: [], repliedUser: false },
  });
}

/** Permissions the bot needs where it is invited. */
export const INVITE_PERMISSIONS = [
  1024n, // View Channels
  2048n, // Send Messages
  64n, // Add Reactions
  16384n, // Embed Links
  32768n, // Attach Files
  65536n, // Read Message History
  34359738368n, // Create Public Threads
  274877906944n, // Send Messages in Threads
].reduce((a, b) => a | b, 0n);

export const inviteUrl = (clientId: string): string =>
  `https://discord.com/oauth2/authorize?client_id=${clientId}&scope=bot&permissions=${INVITE_PERMISSIONS}`;
