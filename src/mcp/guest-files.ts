import { tool } from '@anthropic-ai/claude-agent-sdk';
import type { AttachmentPayload } from 'discord.js';
import { z } from 'zod';
import { redact } from '../discord/redact.ts';
import { NO_PINGS } from '../discord/send.ts';
import { inputsFor, runInSandbox, type Made } from '../guests/files.ts';
import { guard, ok, type ToolHost } from './util.ts';

/** Discord takes 10 MB per message from a bot: bigger batches go in several posts. */
const PER_POST = 9 << 20;

/** Running code to make files for a guest, in a Modal sandbox. What it saves is posted, never stored. */
export function filesTool(host: ToolHost) {
  return tool('make_files',
    'Run Python 3.12 in a throwaway cloud sandbox (NOT this server; no internet; starts empty each run; ~10-60 s). '
    + 'Installed: pandas, numpy, scipy, statsmodels, pingouin, pyreadstat (.sav read/write), python-docx, openpyxl, xlsxwriter, '
    + 'matplotlib, seaborn, reportlab, fpdf2, tabulate, and LibreOffice (`soffice --headless --convert-to pdf --outdir /work/out file.docx`). '
    + 'Attached files named in `inputs` are copied to /work/in/. Every file the code saves in /work/out/ is posted to this thread '
    + '(max 5 files, 8 MB each) and kept nowhere. Print to stdout to check numbers before writing files.',
    {
      code: z.string().min(1).max(100_000),
      inputs: z.array(z.string().max(200)).max(10).default([]).describe('names of files attached in this thread, as listed with their message'),
      message: z.string().max(1500).optional().describe('text posted with the files'),
      timeout_sec: z.number().int().min(10).max(300).default(120),
    },
    (a) => guard(async () => {
      const made = await runInSandbox(a.code, inputsFor(host.taskId, a.inputs), a.timeout_sec);
      const posted = await post(host, made, a.message);
      return ok([
        `exit code ${made.exitCode ?? 'none (timed out?)'}`,
        posted.length ? `Posted in the thread: ${posted.join(', ')}. Nothing was kept on the server.` : 'No files in /work/out: nothing posted.',
        made.skipped.length ? `Not posted (over the limits): ${made.skipped.join('; ')}` : '',
        made.stdout ? `stdout:\n${made.stdout}` : '',
        made.stderr ? `stderr:\n${made.stderr}` : '',
      ].filter(Boolean).join('\n'));
    }), { alwaysLoad: true });
}

/** Sends the files straight from memory, in posts under Discord's size limit. */
async function post(host: ToolHost, made: Made, message?: string): Promise<string[]> {
  const names: string[] = [];
  let batch: AttachmentPayload[] = [];
  let size = 0;
  const flush = async (): Promise<void> => {
    if (!batch.length) return;
    await host.channel.send({ content: !names.length && message ? redact(message) : undefined, files: batch, allowedMentions: NO_PINGS });
    names.push(...batch.map((f) => String(f.name)));
    batch = [];
    size = 0;
  };
  for (const f of made.files) {
    if (size + f.data.length > PER_POST) await flush();
    batch.push({ attachment: f.data, name: f.name });
    size += f.data.length;
  }
  await flush();
  made.files.length = 0;
  return names;
}
