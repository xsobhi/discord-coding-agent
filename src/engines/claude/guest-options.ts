import type { CanUseTool, EffortLevel, Options } from '@anthropic-ai/claude-agent-sdk';
import { guestPrompt } from '../../agent/guest-prompt.ts';
import type { Guest } from '../../guests/guest.ts';
import { guestServer } from '../../mcp/guest-server.ts';
import type { EngineChoice, SessionHost } from '../types.ts';
import { answerQuestions, type PermissionHost } from './permissions.ts';

/** The only built-in tools a guest's session has. Everything that touches the machine is absent. */
const GUEST_TOOLS = ['AskUserQuestion', 'WebSearch'];

/** Removed again by name in case a preset or update brings one back. WebFetch too: it fetches from this machine, localhost included. */
const NEVER = [
  'Bash', 'BashOutput', 'KillShell', 'PowerShell', 'Monitor', 'Read', 'Write', 'Edit', 'MultiEdit', 'NotebookEdit', 'NotebookRead',
  'Glob', 'Grep', 'LS', 'WebFetch', 'Agent', 'Task', 'TaskStop', 'Skill', 'Workflow', 'SendMessage', 'EnterWorktree', 'ExitWorktree',
  'CronCreate', 'CronDelete', 'RemoteTrigger', 'ListMcpResourcesTool', 'ReadMcpResourceTool', 'ReadMcpResourceDirTool',
];

/**
 * A guest's Claude Code session: normal (default) permission mode, never
 * bypass; an empty directory of its own; no user settings, hooks, plugins,
 * CLAUDE.md, auto memory or claude.ai connectors (the owner's mail, drive and so on);
 * only the guest MCP tools. Anything else it asks for is refused, not escalated.
 */
export function guestOptions(host: SessionHost, guest: Guest, choice: EngineChoice, abort: AbortController, relay: PermissionHost): Options {
  return {
    cwd: guest.home,
    permissionMode: 'default',
    settingSources: [],
    strictMcpConfig: true,
    skills: [],
    tools: GUEST_TOOLS,
    disallowedTools: NEVER,
    canUseTool: guestCanUseTool(relay),
    systemPrompt: { type: 'preset', preset: 'claude_code', append: guestPrompt(guest, host.owners, 'claude') },
    mcpServers: { guest: guestServer(host, guest) },
    allowedTools: ['mcp__guest', 'WebSearch'],
    abortController: abort,
    model: choice.model,
    ...(choice.effort ? { effort: choice.effort as EffortLevel } : {}),
    ...(host.resume ? { resume: host.resume } : {}),
    env: {
      ...process.env,
      CLAUDE_AGENT_SDK_CLIENT_APP: 'discord-coding-agent/1.0 guest',
      ENABLE_CLAUDEAI_MCP_SERVERS: 'false',
      CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1',
      CLAUDE_CODE_DISABLE_CLAUDE_MDS: '1',
    },
    stderr: (line) => {
      if (/error|fatal/i.test(line)) console.error('[claude guest]', line.trim());
    },
  };
}

/** Questions go to the thread as buttons (the guest may answer); every other request is refused outright. */
function guestCanUseTool(relay: PermissionHost): CanUseTool {
  return async (toolName, input, opts) => {
    if (toolName === 'AskUserQuestion') return answerQuestions(relay, input, opts.signal);
    return { behavior: 'deny', message: `${toolName} is not available in guest mode (no server, file or shell access). Help without it, or tell the guest it needs an owner.` };
  };
}
