import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { promisify } from 'node:util';
import { config, ROOT } from '../config.ts';
import { errorText, log } from '../log.ts';

const run = promisify(execFile);

/**
 * Formats people record speech in (Discord voice messages are ogg/opus, phones
 * give m4a/mp3). wav/flac/aiff are often music or other large files, so they
 * are only transcribed when asked (scripts/transcribe.ts).
 */
const SPEECH = /\.(ogg|oga|opus|m4a|aac|amr|3gp|webm|weba|mp3|caf)$/i;
const AUTO_MAX_SECONDS = 10 * 60;

export type Transcript = { path: string; text: string; note: string };
type Heard = { text: string; language: string; duration: number };

export const isSpeech = (path: string): boolean => path.startsWith('/') && SPEECH.test(path);

/** Transcripts of the speech-like files among saved attachments. Never throws: a failure is a note. */
export const transcribeAll = (paths: string[]): Promise<Transcript[]> =>
  Promise.all(paths.filter(isSpeech).map((p) => transcribe(p, AUTO_MAX_SECONDS)));

/**
 * The HTTP backend first (TRANSCRIBE_URL), then whisper on this machine (AGENT_WHISPER_PYTHON) if the backend is
 * unset or fails. `lyrics` turns the voice filter off, which otherwise drops singing as non-speech.
 */
export async function transcribe(path: string, maxSeconds = Infinity, lyrics = false): Promise<Transcript> {
  const started = Date.now();
  const length = await seconds(path);
  if (length > maxSeconds) {
    return { path, text: '', note: `not transcribed automatically: ${Math.round(length / 60)} min is over the ${maxSeconds / 60} min limit; run \`node ${join(ROOT, 'scripts/transcribe.ts')} <file>\`` };
  }
  const failures: string[] = [];
  if (config.transcribeUrl) {
    try {
      const r = await viaHttp(path, length, lyrics);
      return { path, text: r.text, note: `HTTP transcriber, ${r.language}, ${r.duration}s audio, took ${since(started)}` };
    } catch (err) {
      failures.push(`HTTP transcriber: ${errorText(err)}`);
      log.warn('http transcription failed', basename(path), errorText(err));
    }
  }
  if (config.whisperPython) {
    try {
      const r = await viaLocal(path, length, lyrics);
      return { path, text: r.text, note: `local whisper, ${r.language}, ${r.duration}s audio, took ${since(started)}` };
    } catch (err) {
      failures.push(`local whisper: ${errorText(err)}`);
    }
  }
  return { path, text: '', note: `not transcribed: ${failures.join('; ') || 'no transcriber configured (set TRANSCRIBE_URL or AGENT_WHISPER_PYTHON)'}` };
}

async function viaHttp(path: string, length: number, lyrics: boolean): Promise<Heard> {
  const query = new URLSearchParams({ vad: lyrics ? '0' : '1', prompt: config.transcribeVocabulary });
  const res = await fetch(`${config.transcribeUrl}/transcribe?${query}`, {
    method: 'POST',
    headers: { ...(config.transcribeToken ? { authorization: `Bearer ${config.transcribeToken}` } : {}), 'content-type': 'application/octet-stream' },
    body: await readFile(path),
    // Allow for a cold start; the rest scales with the audio.
    signal: AbortSignal.timeout(Math.round(60_000 + length * 200)),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
  return (await res.json()) as Heard;
}

async function viaLocal(path: string, length: number, lyrics: boolean): Promise<Heard> {
  const { stdout } = await run(config.whisperPython, ['-I', join(ROOT, 'scripts/whisper_local.py'), path, ...(lyrics ? ['--lyrics'] : [])], {
    timeout: Math.round(60_000 + length * 3_000),
    maxBuffer: 16 << 20,
  });
  return JSON.parse(stdout) as Heard;
}

/** Audio length from ffprobe; 0 when unknown (the transcriber decodes it anyway). */
async function seconds(path: string): Promise<number> {
  try {
    const { stdout } = await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', path], { timeout: 10_000 });
    const n = Number.parseFloat(stdout);
    return Number.isFinite(n) ? n : 0;
  } catch {
    return 0;
  }
}

const since = (t: number): string => `${((Date.now() - t) / 1000).toFixed(1)}s`;
