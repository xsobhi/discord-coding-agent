import { createWriteStream } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { Message } from 'discord.js';
import { config } from '../config.ts';
import { log, errorText } from '../log.ts';

/** Room for large files such as recordings; streamed to disk, never held in memory. */
const MAX_BYTES = 200 << 20;

export const workDir = (taskId: string): string => join(config.dataDir, 'work', taskId);

/** Saves a message's attachments locally so the agent can Read or use them (screenshots, logs, audio). */
export async function saveAttachments(message: Message, taskId: string): Promise<string[]> {
  if (!message.attachments.size) return [];
  const dir = workDir(taskId);
  await mkdir(dir, { recursive: true });
  const saved: string[] = [];
  const taken = new Set<string>();
  for (const a of message.attachments.values()) {
    if (a.size > MAX_BYTES) {
      saved.push(`(skipped ${a.name}: ${Math.round(a.size / 1048576)}MB is over the limit; URL ${a.url})`);
      continue;
    }
    try {
      const res = await fetch(a.url);
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
      const path = join(dir, uniqueName(`${message.id}-${a.name.replace(/[^\w.-]+/g, '_')}`, taken));
      await pipeline(Readable.fromWeb(res.body as never), createWriteStream(path));
      saved.push(path);
    } catch (err) {
      log.warn('attachment download failed', a.url, errorText(err));
      saved.push(`(could not download ${a.name}: ${errorText(err)}; URL ${a.url})`);
    }
  }
  return saved;
}

/** Discord names every pasted screenshot "image.png": number the repeats (image-2.png) so one message's files never overwrite each other. */
export function uniqueName(name: string, taken: Set<string>): string {
  const dot = name.lastIndexOf('.');
  const [stem, ext] = dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ''];
  let candidate = name;
  for (let n = 2; taken.has(candidate); n++) candidate = `${stem}-${n}${ext}`;
  taken.add(candidate);
  return candidate;
}
