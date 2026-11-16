import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { config } from '../config.ts';
import { errorText, log } from '../log.ts';
import type { AgentSettings, Engine, EngineChoice } from './types.ts';

const file = join(config.dataDir, 'settings.json');
let defaults: AgentSettings = initial();

/** First run: copy what the terminal CLIs on this machine are set to. */
function initial(): AgentSettings {
  return { engine: 'claude', claude: fromClaudeSettings(), codex: fromCodexConfig() };
}

function fromClaudeSettings(): EngineChoice {
  try {
    const s = JSON.parse(readFileSync(join(homedir(), '.claude', 'settings.json'), 'utf8'));
    return { model: config.model ?? s.model ?? 'opus', effort: s.effortLevel ?? 'high' };
  } catch {
    return { model: config.model ?? 'opus', effort: 'high' };
  }
}

function fromCodexConfig(): EngineChoice {
  try {
    const toml = readFileSync(join(homedir(), '.codex', 'config.toml'), 'utf8');
    const top = toml.split(/^\[/m)[0] ?? '';
    const model = top.match(/^model\s*=\s*"([^"]+)"/m)?.[1];
    const effort = top.match(/^model_reasoning_effort\s*=\s*"([^"]+)"/m)?.[1];
    return { model: model ?? config.codexModel, effort: effort ?? 'high' };
  } catch {
    return { model: config.codexModel, effort: 'high' };
  }
}

export function loadSettings(): void {
  try {
    const saved = JSON.parse(readFileSync(file, 'utf8')) as Partial<AgentSettings>;
    defaults = { ...defaults, ...saved };
  } catch {
    // No saved defaults yet: keep the CLI-derived ones.
  }
}

/** Bot-wide defaults, used for new tasks. Always a copy. */
export const getDefaults = (): AgentSettings => structuredClone(defaults);

export function setDefaults(next: AgentSettings): void {
  defaults = structuredClone(next);
  try {
    mkdirSync(config.dataDir, { recursive: true });
    writeFileSync(`${file}.tmp`, JSON.stringify(defaults, null, 2));
    renameSync(`${file}.tmp`, file);
  } catch (err) {
    log.error('settings write failed', errorText(err));
  }
}

export const activeChoice = (s: AgentSettings): EngineChoice => s[s.engine];

export const describeSettings = (s: AgentSettings, engine: Engine = s.engine): string =>
  `${s[engine].model}${s[engine].effort ? ` · ${s[engine].effort}` : ''}`;
