import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';

// The env file is parsed into this object instead of process.env, so the Claude
// Code and Codex child processes never inherit the bot token.
export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const envFile = process.env.AGENT_ENV_FILE || join(ROOT, '.env');
if (!existsSync(envFile)) throw new Error(`${envFile} not found: copy .env.example to .env and fill it in`);
const env = { ...parseEnv(readFileSync(envFile, 'utf8')), ...pick(process.env, 'AGENT_') };

function pick(source: NodeJS.ProcessEnv, prefix: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(source)) if (k.startsWith(prefix) && v !== undefined) out[k] = v;
  return out;
}

function required(name: string): string {
  const value = env[name]?.trim();
  if (!value) throw new Error(`${name} is missing from ${envFile}`);
  return value;
}

const list = (name: string): string[] => (env[name] ?? '').split(',').map((s) => s.trim()).filter(Boolean);
const ids = (name: string): Set<string> => new Set(list(name));

/** A path setting: `~/` means your home directory, a relative path starts from this repository, empty means the fallback. */
function path(name: string, fallback: string): string {
  const value = env[name]?.trim();
  if (!value) return fallback;
  return resolve(ROOT, value === '~' || value.startsWith('~/') ? join(homedir(), value.slice(1)) : value);
}

function number(name: string, fallback: number): number {
  const value = Number(env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

export const config = {
  token: required('DISCORD_TOKEN'),
  clientId: required('DISCORD_CLIENT_ID'),
  /** Discord user ids whose messages are instructions. Nobody else's are. */
  owners: new Set(required('AGENT_ALLOWED_USERS').split(',').map((s) => s.trim()).filter(Boolean)),
  /** Restricted users: they get tasks of their own in a sandbox (no shell, files, memory or server). Owners always win. */
  guests: ids('AGENT_GUEST_USERS'),
  /** Guests who may run code to make files: only ever in a throwaway Modal sandbox (modal/guest_files.py), never here. */
  guestFiles: ids('AGENT_GUEST_FILES'),
  /** The Python that has the `modal` client installed, and an optional Modal profile (token in ~/.modal.toml). */
  modalPython: env.AGENT_MODAL_PYTHON || 'python3',
  modalProfile: env.AGENT_MODAL_PROFILE || '',
  /** Each guest's empty working directory, outside every repo so no project instructions load. */
  guestHome: path('AGENT_GUEST_HOME', join(homedir(), 'agent-guests')),
  /** Channels where an owner's message needs no mention (their threads keep the usual rule). DMs never need one. */
  openChannels: ids('AGENT_OPEN_CHANNELS'),
  /** Servers where the bot keeps a low profile: tasks run in private threads and leave no marks in the channels. */
  undercoverGuilds: ids('AGENT_UNDERCOVER_GUILDS'),
  /** Where the agent starts. Defaults to your home directory. */
  cwd: path('AGENT_CWD', homedir()),
  model: env.AGENT_MODEL || undefined,
  /** First-run Codex model when ~/.codex/config.toml names none; /model lists what your account offers. */
  codexModel: env.AGENT_CODEX_MODEL || 'gpt-6-astra',
  /**
   * How much the owners' tasks may do without asking. `auto` (default): Claude's auto mode and Codex's reviewed
   * on-request approvals in a workspace-write sandbox; what they cannot decide comes to the owners as buttons.
   * `bypass`: Claude bypassPermissions and Codex with no approvals and no sandbox. Guests are never affected.
   */
  permissionMode: env.AGENT_PERMISSION_MODE === 'bypass' ? ('bypass' as const) : ('auto' as const),
  /** Your own instructions for the agent (what machine this is, what to be careful with); see instructions.example.md. */
  instructionsFile: path('AGENT_INSTRUCTIONS_FILE', join(ROOT, 'instructions.md')),
  /** Optional notes added to guests' prompts only (what to help with, tone). Never mention your own systems there. */
  guestInstructionsFile: path('AGENT_GUEST_INSTRUCTIONS_FILE', join(ROOT, 'guest-instructions.md')),
  /** Optional directory of notes shared between sessions; Codex is pointed at it (Claude uses its own project memory). */
  memoryDir: path('AGENT_MEMORY_DIR', ''),
  /** Directories searched for .env files whose values are then redacted from everything the bot posts. */
  secretScanDirs: [...new Set([ROOT, ...(list('AGENT_SECRET_SCAN_DIRS').length ? list('AGENT_SECRET_SCAN_DIRS') : [homedir()])])],
  /** Task records and attachments; a test harness points this elsewhere so it never touches the live bot's. */
  dataDir: path('AGENT_DATA_DIR', join(ROOT, 'data')),
  contextMessages: number('AGENT_CONTEXT_MESSAGES', 10),
  maxConcurrent: number('AGENT_MAX_CONCURRENT', 3),
  turnMaxMinutes: number('AGENT_TURN_MAX_MINUTES', 120),
  idleCloseMinutes: number('AGENT_IDLE_CLOSE_MINUTES', 15),
  approvalMinutes: number('AGENT_APPROVAL_MINUTES', 30),
  /** Only used to tell the agent which process it is running in. */
  pm2Name: env.AGENT_PM2_NAME || 'discord-agent',
  /** Voice-note speech-to-text over HTTP (see README, "Voice messages"); without a URL, voice notes need the local fallback. */
  transcribeUrl: (env.TRANSCRIBE_URL || '').replace(/\/+$/, ''),
  transcribeToken: env.TRANSCRIBE_TOKEN?.trim() || '',
  /** Names and terms the transcriber should spell right (comma separated). */
  transcribeVocabulary: env.TRANSCRIBE_VOCABULARY || '',
  /** A Python with faster-whisper installed, for transcribing on this machine when the HTTP backend is unset or down. */
  whisperPython: env.AGENT_WHISPER_PYTHON || '',
};

export const isOwner = (userId: string): boolean => config.owners.has(userId);
export const isGuest = (userId: string): boolean => !isOwner(userId) && config.guests.has(userId);
export const isUndercover = (guildId: string | null | undefined): boolean => Boolean(guildId && config.undercoverGuilds.has(guildId));
