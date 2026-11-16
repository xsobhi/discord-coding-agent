import type { GuildMember, Message, User } from 'discord.js';
import { isGuest, isOwner } from '../config.ts';
import { clip } from './chunk.ts';

/** `<@123>` → `@name (123)`, `<#123>` → `#channel`, `<@&123>` → `@role`. Keeps ids visible to Claude. */
export function resolveMentions(message: Message): string {
  return message.content
    .replace(/<@!?(\d+)>/g, (_m, id: string) => {
      const user = message.mentions.users.get(id);
      if (id === message.client.user.id) return '@me';
      return user ? `@${user.globalName ?? user.username} (${id})` : `@user(${id})`;
    })
    .replace(/<#(\d+)>/g, (_m, id: string) => {
      const ch = message.client.channels.cache.get(id);
      return ch && 'name' in ch && ch.name ? `#${ch.name} (${id})` : `#channel(${id})`;
    })
    .replace(/<@&(\d+)>/g, (_m, id: string) => `@${message.guild?.roles.cache.get(id)?.name ?? 'role'}`);
}

export function who(user: User, member?: GuildMember | null): string {
  const display = member?.displayName ?? user.globalName ?? user.username;
  const tags = [isOwner(user.id) ? 'OWNER' : isGuest(user.id) ? 'GUEST' : '', user.bot ? 'bot' : ''].filter(Boolean).join(', ');
  return `${display} (@${user.username}, id ${user.id}${tags ? `, ${tags}` : ''})`;
}

/** One message as a compact, attributed line block for the model. */
export function describe(message: Message, max = 1500): string {
  const when = message.createdAt.toISOString().replace('T', ' ').slice(0, 16);
  const parts = [`[${when} UTC] ${who(message.author, message.member)} — msg ${message.id}`];
  if (message.reference?.messageId) parts[0] += ` (reply to ${message.reference.messageId})`;
  const text = resolveMentions(message).trim();
  if (text) parts.push(clip(text, max));
  for (const a of message.attachments.values()) {
    parts.push(`  [attachment ${a.name} ${a.contentType ?? ''} ${Math.round(a.size / 1024)}KB ${a.url}]`);
  }
  for (const e of message.embeds.slice(0, 3)) {
    const body = [e.title, e.description, ...e.fields.map((f) => `${f.name}: ${f.value}`)].filter(Boolean).join(' | ');
    if (body) parts.push(`  [embed] ${clip(body, 600)}`);
  }
  for (const s of message.stickers.values()) parts.push(`  [sticker ${s.name}]`);
  if (!text && parts.length === 1) parts.push('  (no text)');
  return parts.join('\n');
}

export function where(message: Message): string {
  const ch = message.channel;
  const name = 'name' in ch && ch.name ? `#${ch.name}` : 'DM';
  const parent = ch.isThread() && ch.parent ? ` in #${ch.parent.name} (${ch.parent.id})` : '';
  const guild = message.guild ? `server "${message.guild.name}" (${message.guild.id}) › ` : '';
  return `${guild}${name} (${ch.id})${parent}`;
}
