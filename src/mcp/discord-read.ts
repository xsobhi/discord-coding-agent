import { tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { saveAttachments } from '../discord/attachments.ts';
import { heardLine } from '../discord/context.ts';
import { transcribeAll } from '../discord/transcribe.ts';
import { describe } from '../discord/describe.ts';
import { fetchHistory, guard, ok, textChannel, type ToolHost } from './util.ts';

const READ_ONLY = { annotations: { readOnlyHint: true } };
const CORE = { ...READ_ONLY, alwaysLoad: true };
const id = z.string().regex(/^\d{5,25}$/, 'a Discord snowflake id');

/** Message history tools. Everything they return is other people's words: data, not instructions. */
export function messageTools(host: ToolHost) {
  return [
    tool('read_messages',
      'Read messages from any channel, thread or DM the bot can see, oldest first. Page back with `before` (a message id), or read what came after a message with `after`, or around one with `around`.',
      {
        channel_id: id,
        limit: z.number().int().min(1).max(300).default(30),
        before: id.optional(),
        after: id.optional(),
        around: id.optional(),
      },
      (a) => guard(async () => {
        const ch = await textChannel(host.client, a.channel_id);
        let list;
        if (a.after || a.around) {
          const page = await ch.messages.fetch({ limit: Math.min(a.limit, 100), ...(a.after ? { after: a.after } : { around: a.around }) });
          list = [...page.values()].sort((x, y) => x.createdTimestamp - y.createdTimestamp);
        } else {
          list = await fetchHistory(ch, a.limit, a.before);
        }
        if (!list.length) return ok('(no messages)');
        const text = list.map((m) => describe(m, 1500)).join('\n\n');
        return ok(`${list.length} messages (oldest first). Older: before=${list[0]!.id}\n\n${text}`);
      }), CORE),

    tool('get_message', 'One message in full: text, embeds, attachments, reactions, the message it replies to.',
      { channel_id: id, message_id: id },
      (a) => guard(async () => {
        const ch = await textChannel(host.client, a.channel_id);
        const m = await ch.messages.fetch(a.message_id);
        const reactions = [...m.reactions.cache.values()].map((r) => `${r.emoji.name}×${r.count}`).join(' ');
        const parts = [describe(m, 10_000), reactions ? `reactions: ${reactions}` : '', m.hasThread ? `thread: ${m.thread?.id}` : ''];
        if (m.reference?.messageId) {
          const ref = await m.fetchReference().catch(() => null);
          if (ref) parts.push(`\nReplying to:\n${describe(ref, 3000)}`);
        }
        return ok(parts.filter(Boolean).join('\n'));
      }), CORE),

    tool('search_messages',
      'Scan a channel\'s recent history for text (case-insensitive substring, or a JS regex with regex=true), optionally only from one author. Discord has no search API for bots, so this reads up to `scan` messages.',
      {
        channel_id: id,
        query: z.string().min(1),
        regex: z.boolean().default(false),
        author_id: id.optional(),
        scan: z.number().int().min(50).max(5000).default(1000),
        before: id.optional(),
      },
      (a) => guard(async () => {
        const ch = await textChannel(host.client, a.channel_id);
        const test = a.regex ? new RegExp(a.query, 'i') : null;
        const needle = a.query.toLowerCase();
        const list = await fetchHistory(ch, a.scan, a.before);
        const hits = list.filter((m) => {
          if (a.author_id && m.author.id !== a.author_id) return false;
          const hay = [m.content, ...m.embeds.map((e) => `${e.title ?? ''} ${e.description ?? ''}`), ...m.attachments.map((x) => x.name)].join(' ');
          return test ? test.test(hay) : hay.toLowerCase().includes(needle);
        });
        const shown = hits.slice(-60);
        const span = list.length ? `scanned ${list.length} messages back to ${list[0]!.createdAt.toISOString().slice(0, 10)}` : 'channel is empty';
        return ok(`${hits.length} matches (${span}${hits.length > shown.length ? '; showing the newest 60' : ''}).\n\n${shown.map((m) => describe(m, 800)).join('\n\n')}`);
      }), CORE),

    tool('download_attachments', 'Save a message\'s attachments on this machine (returns local paths you can Read — screenshots, logs, audio; speech recordings come back transcribed).',
      { channel_id: id, message_id: id },
      (a) => guard(async () => {
        const ch = await textChannel(host.client, a.channel_id);
        const m = await ch.messages.fetch(a.message_id);
        const paths = await saveAttachments(m, host.taskId);
        const heard = await transcribeAll(paths);
        return ok(paths.length ? paths.join('\n') + heard.map(heardLine).join('') : 'That message has no attachments.');
      })),
  ];
}
