import { execFile } from 'node:child_process';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';
import { getSessionMessages, listSessions, tool, type SDKSessionInfo } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { clip } from '../discord/chunk.ts';
import { guard, ok } from './util.ts';

const READ_ONLY = { annotations: { readOnlyHint: true } };
const PROJECTS = join(homedir(), '.claude', 'projects');

/** Past Claude Code sessions on this machine: what has already been tried and done. */
export function historyTools() {
  return [
    tool('search_past_sessions',
      'Find earlier Claude Code sessions on this machine (terminal sessions and this bot\'s own tasks) by words in their title or first prompt. deep=true also greps the full transcripts, which finds sessions that only mention the term in passing.',
      { query: z.string().min(2), deep: z.boolean().default(false), limit: z.number().int().min(1).max(50).default(15) },
      (a) => guard(async () => {
        const all = await listSessions({ limit: 5000 });
        const terms = a.query.toLowerCase().split(/\s+/).filter(Boolean);
        const hay = (s: SDKSessionInfo): string => [s.customTitle, s.summary, s.firstPrompt, s.cwd, s.tag].join(' ').toLowerCase();
        let hits = all.filter((s) => terms.every((t) => hay(s).includes(t)));
        if (a.deep || hits.length < 3) {
          const ids = new Set(await grepTranscripts(a.query));
          const seen = new Set(hits.map((s) => s.sessionId));
          hits = hits.concat(all.filter((s) => ids.has(s.sessionId) && !seen.has(s.sessionId)));
        }
        hits.sort((x, y) => y.lastModified - x.lastModified);
        const lines = hits.slice(0, a.limit).map((s) =>
          `- ${new Date(s.lastModified).toISOString().slice(0, 10)} · ${s.sessionId} · ${s.cwd ?? '?'}\n  ${clip(s.customTitle ?? s.summary ?? s.firstPrompt ?? '', 200)}`);
        return ok(lines.length ? `${hits.length} sessions match (newest first):\n${lines.join('\n')}` : 'No sessions match. Try other words or deep=true.');
      }), { ...READ_ONLY, alwaysLoad: true }),

    tool('read_past_session',
      'Read the conversation of an earlier session (user and assistant text; tool calls shown by name only). Page with offset.',
      { session_id: z.string().uuid(), offset: z.number().int().min(0).default(0), limit: z.number().int().min(1).max(80).default(30) },
      (a) => guard(async () => {
        const messages = await getSessionMessages(a.session_id, { offset: a.offset, limit: a.limit });
        if (!messages.length) return ok('No messages at that offset (or no such session).');
        const lines = messages.map((m, i) => `#${a.offset + i} ${m.type}: ${render(m.message)}`).filter((l) => !l.endsWith(': '));
        return ok(`${lines.join('\n\n')}\n\n(next page: offset=${a.offset + messages.length})`);
      }), READ_ONLY),
  ];
}

function render(message: unknown): string {
  const content = (message as { content?: unknown })?.content;
  if (typeof content === 'string') return clip(content, 2000);
  if (!Array.isArray(content)) return '';
  const parts: string[] = [];
  for (const block of content as { type?: string; text?: string; name?: string }[]) {
    if (block.type === 'text' && block.text) parts.push(clip(block.text, 2000));
    else if (block.type === 'tool_use') parts.push(`[used ${block.name}]`);
  }
  return parts.join(' ');
}

function grepTranscripts(query: string): Promise<string[]> {
  return new Promise((resolve) => {
    execFile('grep', ['-rliF', '--include=*.jsonl', '--', query, PROJECTS], { timeout: 45_000, maxBuffer: 16 << 20, windowsHide: true },
      (_err, out) => resolve(String(out ?? '').split('\n').filter(Boolean).slice(0, 400).map((p) => basename(p, '.jsonl'))));
  });
}
