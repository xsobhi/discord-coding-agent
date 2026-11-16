import type { EffortLevel, Options } from '@anthropic-ai/claude-agent-sdk';
import { config } from '../../config.ts';
import { systemPromptAppend } from '../../agent/system-prompt.ts';
import { discordServer } from '../../mcp/server.ts';
import type { EngineChoice, SessionHost } from '../types.ts';
import { guestOptions } from './guest-options.ts';
import { makeCanUseTool } from './permissions.ts';

/**
 * One Claude Code session per task, configured like a terminal session on this
 * machine (same settings, memory, plugins) but in auto mode (or bypass, if
 * AGENT_PERMISSION_MODE says so), with Discord as the only way to ask the owners anything.
 */
export function sessionOptions(host: SessionHost, choice: EngineChoice, abort: AbortController): Options {
  const relay = {
    channel: host.channel,
    threadId: host.threadId,
    ping: () => host.driver(),
    waiting: (note: string) => host.sink.waiting(note),
    working: () => host.sink.working(),
  };
  // A guest's task never gets the owners' setup below: its own sandboxed session instead.
  if (host.guest) return guestOptions(host, host.guest, choice, abort, relay);
  return {
    cwd: config.cwd,
    // auto: a classifier approves or blocks each action; what it cannot decide comes to the owners as buttons.
    // bypass (AGENT_PERMISSION_MODE=bypass): nothing is asked. Guest tasks never get either (guest-options.ts).
    permissionMode: config.permissionMode === 'bypass' ? 'bypassPermissions' : 'auto',
    ...(config.permissionMode === 'bypass' ? { allowDangerouslySkipPermissions: true } : {}),
    canUseTool: makeCanUseTool(relay),
    systemPrompt: { type: 'preset', preset: 'claude_code', append: systemPromptAppend(host.owners, 'claude') },
    tools: { type: 'preset', preset: 'claude_code' },
    mcpServers: { discord: discordServer(host) },
    // Reading Discord is always fine; the one sending tool gates itself on an owner's button.
    allowedTools: ['mcp__discord'],
    abortController: abort,
    model: choice.model,
    ...(choice.effort ? { effort: choice.effort as EffortLevel } : {}),
    ...(host.resume ? { resume: host.resume } : {}),
    env: { ...process.env, CLAUDE_AGENT_SDK_CLIENT_APP: 'discord-coding-agent/1.0' },
    stderr: (line) => {
      if (/error|fatal/i.test(line)) console.error('[claude]', line.trim());
    },
  };
}
