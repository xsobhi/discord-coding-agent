import { stat } from 'node:fs/promises';
import { basename } from 'node:path';
import { tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { askOwners } from '../agent/approvals.ts';
import { chunk, clip } from '../discord/chunk.ts';
import { redact } from '../discord/redact.ts';
import { NO_PINGS, postText } from '../discord/send.ts';
import { fail, guard, ok, signalOf, textChannel, type ToolHost } from './util.ts';

const id = z.string().regex(/^\d{5,25}$/, 'a Discord snowflake id');
const MAX_FILE = 10 << 20;

/** Ways to reach Discord beyond the task's own thread replies. */
export function writeTools(host: ToolHost) {
  return [
    tool('post_file',
      'Attach a file from this machine to your own task thread (a screenshot of the fixed page, a log excerpt). Never a file holding secrets. Max 10 MB.',
      { path: z.string().min(1), caption: z.string().max(1500).optional() },
      (a) => guard(async () => {
        const info = await stat(a.path);
        if (!info.isFile()) return fail(`${a.path} is not a file`);
        if (info.size > MAX_FILE) return fail(`${a.path} is ${Math.round(info.size / 1048576)} MB; Discord takes 10 MB`);
        const sent = await host.channel.send({
          content: a.caption ? redact(a.caption) : undefined,
          files: [{ attachment: a.path, name: basename(a.path) }],
          allowedMentions: NO_PINGS,
        });
        return ok(`Posted ${basename(a.path)} in your thread (${sent.url}).`);
      }), { alwaysLoad: true }),

    // Text between tool calls can end up in the model's reasoning and never be posted; a tool call always arrives.
    tool('reply',
      'Post a message in your own task thread now: an answer to an owner\'s question, or a result they are waiting for. Give `reply_to_message_id` (the owner\'s message in this thread) to answer it as a Discord reply. A tool call always arrives, while text written between tool calls can be lost in your reasoning. Write it once: do not repeat the same words as text.',
      { text: z.string().min(1).max(8000), reply_to_message_id: id.optional() },
      (a) => guard(async () => {
        // the first piece answers the owner's message as a Discord reply, no pings
        const [first, ...rest] = chunk(redact(a.text));
        const sent = await host.channel.send({ content: first, allowedMentions: NO_PINGS,
          ...(a.reply_to_message_id ? { reply: { messageReference: a.reply_to_message_id, failIfNotExists: false } } : {}) });
        for (const piece of rest) await postText(host.channel, piece);
        return ok(`Posted in your thread (${sent.url}).`);
      }), { alwaysLoad: true }),

    titleTool(host),

    tool('send_message',
      'Post a message anywhere outside your own thread (for example to tell the person who reported a bug that it is fixed). An owner must approve each one with a button first, so say why in `reason`. May ping the people you reply to.',
      { channel_id: id, content: z.string().min(1).max(1900), reply_to_message_id: id.optional(), reason: z.string().max(400) },
      (a, extra) => guard(async () => {
        const ch = await textChannel(host.client, a.channel_id);
        if (!ch.isSendable()) return fail('The bot cannot send messages in that channel.');
        const name = 'name' in ch && ch.name ? `#${ch.name}` : 'a DM';
        const content = redact(a.content);
        const outcome = await askOwners(host.channel, {
          title: `Send a message in ${name}${a.reply_to_message_id ? ' (as a reply)' : ''}?`,
          detail: content,
          reason: a.reason,
          offerTaskWide: false,
        }, signalOf(extra), host.driver?.());
        if (outcome.verdict === 'deny') return fail(`Not sent: ${outcome.note}.`);
        const sent = await ch.send({
          content,
          allowedMentions: { parse: ['users'], repliedUser: true },
          ...(a.reply_to_message_id ? { reply: { messageReference: a.reply_to_message_id, failIfNotExists: false } } : {}),
        });
        return ok(`Sent (${outcome.note}): ${sent.url}`);
      }), { alwaysLoad: true }),

    tool('restart_self',
      'Restart this Discord bot after your current turn has finished and its summary is posted — use it after changing the bot\'s own code. Never restart or stop the bot\'s process directly: that kills you mid-task. (The bot exits and relies on its process manager, PM2 or systemd, to start it again.)',
      { why: z.string().max(300) },
      (a) => guard(async () => {
        host.requestRestart();
        return ok(`Restart scheduled (${clip(a.why, 100)}). It happens once every running task is idle.`);
      }), { alwaysLoad: true }),
  ];
}

/** Shared with guest tasks: renaming its own thread is all a guest's agent may do in Discord. */
export function titleTool(host: ToolHost) {
  return tool('set_title',
    'Name your task thread: 3-7 words saying what the task is about, e.g. "Upload page hangs at 99%" or "Nginx 502 after deploy", never a copy of the request. Do it as your first action in a new task, and again only if the task becomes something else (Discord allows 2 renames per 10 minutes).',
    { title: z.string().min(3).max(90) },
    (a) => guard(async () => (host.retitle ? ok(await host.retitle(a.title)) : fail('Renaming is not available here.'))),
    { alwaysLoad: true });
}
