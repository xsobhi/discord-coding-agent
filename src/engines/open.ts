import { ClaudeSession } from './claude/session.ts';
import { CodexSession } from './codex/session.ts';
import type { Engine, EngineChoice, EngineSession, SessionHost } from './types.ts';

export async function openSession(engine: Engine, host: SessionHost, choice: EngineChoice): Promise<EngineSession> {
  return engine === 'claude' ? new ClaudeSession(host, choice) : CodexSession.open(host, choice);
}
