import { spawn } from 'node:child_process';
import { realpathSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';
import { config, ROOT } from '../config.ts';
import { workDir } from '../discord/attachments.ts';

/**
 * A guest's code never runs on this machine: modal/guest_files.py starts a fresh
 * Modal sandbox (no network, no secrets), runs it there, and returns what it
 * saved. The files stay in memory until they are posted, then they are gone.
 */
export type Made = { exitCode: number | null; stdout: string; stderr: string; files: { name: string; data: Buffer }[]; skipped: string[] };
export type Input = { name: string; path: string };

const RUNNER = join(ROOT, 'modal', 'guest_files.py');
const MAX_INPUT = 50 << 20;
const MAX_STDOUT = 80 << 20;

/** Attachment names, resolved only inside this task's own download folder. */
export function inputsFor(taskId: string, names: string[]): Input[] {
  if (!names.length) return [];
  let dir: string;
  try { dir = realpathSync(workDir(taskId)); } catch { throw new Error('This task has no attached files (or they were already cleaned up): ask them to attach the file again.'); }
  return names.map((n) => {
    const name = basename(n.trim());
    if (!/^[\w.-]+$/.test(name)) throw new Error(`"${n}" is not an attached file name (use the names listed with their message).`);
    let path: string;
    try { path = realpathSync(join(dir, name)); } catch { throw new Error(`${name} is not attached in this task (or was cleaned up): ask them to send it again.`); }
    if (!path.startsWith(`${dir}/`)) throw new Error(`${name} is not an attached file.`);
    if (statSync(path).size > MAX_INPUT) throw new Error(`${name} is over ${MAX_INPUT >> 20} MB.`);
    return { name, path };
  });
}

export function runInSandbox(code: string, inputs: Input[], timeoutSec: number): Promise<Made> {
  return new Promise((resolve, reject) => {
    // A bare environment: the runner needs the Modal profile and nothing of the bot's.
    const child = spawn(config.modalPython, [RUNNER], {
      env: { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: process.env.HOME ?? '/root', ...(config.modalProfile ? { MODAL_PROFILE: config.modalProfile } : {}) },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const out: Buffer[] = [];
    let size = 0;
    let err = '';
    const killer = setTimeout(() => child.kill('SIGKILL'), (timeoutSec + 300) * 1000);
    child.stdout.on('data', (d: Buffer) => {
      size += d.length;
      if (size > MAX_STDOUT) child.kill('SIGKILL');
      else out.push(d);
    });
    child.stderr.on('data', (d: Buffer) => { err = (err + d.toString()).slice(-4000); });
    child.on('error', (e) => { clearTimeout(killer); reject(e); });
    child.on('close', () => {
      clearTimeout(killer);
      let r: { ok?: boolean; error?: string; exit_code?: number | null; stdout?: string; stderr?: string; files?: { name: string; b64: string }[]; skipped?: string[] };
      try {
        r = JSON.parse(Buffer.concat(out).toString().trim().split('\n').pop() ?? '');
      } catch {
        reject(new Error(`The sandbox runner failed: ${err.trim().split('\n').slice(-3).join(' ') || 'no output'}`));
        return;
      }
      if (!r.ok) return reject(new Error(`Sandbox error: ${r.error ?? 'unknown'}`));
      resolve({
        exitCode: r.exit_code ?? null, stdout: r.stdout ?? '', stderr: r.stderr ?? '', skipped: r.skipped ?? [],
        files: (r.files ?? []).map((f) => ({ name: safeName(f.name), data: Buffer.from(f.b64, 'base64') })),
      });
    });
    child.stdin.end(JSON.stringify({ code, inputs, timeout: timeoutSec }));
  });
}

const safeName = (name: string): string => basename(name).replace(/[^\w.\- ()]+/g, '_').slice(0, 100) || 'file';
