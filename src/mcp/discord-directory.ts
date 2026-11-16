import { tool } from '@anthropic-ai/claude-agent-sdk';
import { ChannelType, type Guild, type GuildMember } from 'discord.js';
import { z } from 'zod';
import { isOwner } from '../config.ts';
import { guard, ok, type ToolHost } from './util.ts';

const READ_ONLY = { annotations: { readOnlyHint: true } };
const CORE = { ...READ_ONLY, alwaysLoad: true };
const id = z.string().regex(/^\d{5,25}$/, 'a Discord snowflake id');

/** Servers, channels and people the bot can see. */
export function directoryTools(host: ToolHost) {
  const guild = async (gid: string): Promise<Guild> => {
    const g = await host.client.guilds.fetch(gid).catch(() => null);
    if (!g) throw new Error(`the bot is not in server ${gid} (list_servers shows where it is)`);
    return g;
  };

  return [
    tool('list_servers', 'Every Discord server the bot is in.', {}, () => guard(async () => {
      const lines = host.client.guilds.cache.map((g) => `- ${g.name} (id ${g.id}) · ${g.memberCount} members`);
      return ok(lines.length ? lines.join('\n') : 'The bot is not in any server.');
    }), READ_ONLY),

    tool('list_channels', 'Channels, forums and active threads in a server, each with its category.', { server_id: id }, (a) => guard(async () => {
      const g = await guild(a.server_id);
      const channels = await g.channels.fetch();
      const threads = await g.channels.fetchActiveThreads().catch(() => null);
      const lines: string[] = [];
      for (const ch of channels.values()) {
        if (!ch || ch.type === ChannelType.GuildCategory) continue;
        const topic = 'topic' in ch && ch.topic ? ` — ${ch.topic.slice(0, 120)}` : '';
        lines.push(`- ${ch.parent ? `[${ch.parent.name}] ` : ''}#${ch.name} (id ${ch.id}, ${ChannelType[ch.type]})${topic}`);
      }
      for (const t of threads?.threads.values() ?? []) lines.push(`- thread "${t.name}" (id ${t.id}) in #${t.parent?.name ?? '?'}`);
      return ok(lines.join('\n') || 'No channels visible.');
    }), READ_ONLY),

    tool('get_member', 'Who someone is: names, roles, join date, whether they are a bot or an owner of this agent. Leave server_id out for a plain user lookup.',
      { user_id: id, server_id: id.optional() }, (a) => guard(async () => {
        const user = await host.client.users.fetch(a.user_id);
        const head = `${user.globalName ?? user.username} (@${user.username}, id ${user.id})${user.bot ? ' [bot]' : ''}${isOwner(user.id) ? ' [OWNER]' : ''}\ncreated ${user.createdAt.toISOString().slice(0, 10)}`;
        if (!a.server_id) return ok(head);
        const g = await guild(a.server_id);
        const m = await g.members.fetch(a.user_id).catch(() => null);
        return ok(m ? `${head}\n${memberLine(m)}` : `${head}\nnot a member of ${g.name}`);
      }), CORE),

    tool('find_member', 'Search a server\'s members by name prefix.', { server_id: id, query: z.string().min(1) }, (a) => guard(async () => {
      const g = await guild(a.server_id);
      const found = await g.members.search({ query: a.query, limit: 15 });
      const lines = found.map((m) => `- ${m.displayName} (@${m.user.username}, id ${m.id})${isOwner(m.id) ? ' [OWNER]' : ''}`);
      return ok(lines.length ? lines.join('\n') : 'No members match.');
    }), READ_ONLY),
  ];
}

function memberLine(m: GuildMember): string {
  const roles = m.roles.cache.filter((r) => r.id !== m.guild.id).map((r) => r.name);
  return `in ${m.guild.name}: shown as "${m.displayName}", joined ${m.joinedAt?.toISOString().slice(0, 10) ?? '?'}, roles: ${roles.join(', ') || 'none'}`;
}
