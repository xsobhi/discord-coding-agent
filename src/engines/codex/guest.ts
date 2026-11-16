import { guestPrompt } from '../../agent/guest-prompt.ts';
import type { Guest } from '../../guests/guest.ts';

/**
 * Codex for a guest: no shell or exec tool at all, a read-only sandbox, and
 * approvals routed to us (never auto-approved) so the few that could still come
 * up are declined. Apps (ChatGPT connectors), plugins, browsers, memories,
 * hooks and project docs are off; the only MCP server is the guest's.
 */
const OFF = [
  'shell_tool', 'unified_exec', 'apps', 'plugins', 'remote_plugin', 'memories', 'multi_agent', 'browser_use',
  'browser_use_external', 'computer_use', 'in_app_browser', 'image_generation', 'view_image', 'hooks', 'code_mode_host',
  'goals', 'worktrees', 'tool_suggest', 'skill_mcp_dependency_install', 'workspace_dependencies', 'in_app_local_automation',
];

export function guestThreadParams(guest: Guest, owners: string[], model: string, toolsUrl: string) {
  return {
    cwd: guest.home,
    approvalPolicy: 'on-request',
    approvalsReviewer: 'user',
    sandbox: 'read-only',
    model,
    developerInstructions: guestPrompt(guest, owners, 'codex'),
    config: {
      mcp_servers: { guest: { url: toolsUrl, tool_timeout_sec: 3600, startup_timeout_sec: 30 } },
      features: { default_mode_request_user_input: true, ...Object.fromEntries(OFF.map((f) => [f, false])) },
      project_doc_max_bytes: 0,
    },
  } as const;
}

/**
 * What a guest's Codex gets back when it asks for anything: calls to the guest's own MCP tools (title and
 * make_files; Codex asks before each under on-request) are allowed; running, writing or widening anything is
 * declined, without asking anyone.
 */
export function guestAnswer(method: string, p: Record<string, any>): unknown {
  switch (method) {
    case 'mcpServer/elicitation/request':
      return p.serverName === 'guest' && p._meta?.codex_approval_kind === 'mcp_tool_call'
        ? { action: 'accept', content: {}, _meta: null }
        : { action: 'decline', content: null, _meta: null };
    case 'item/commandExecution/requestApproval':
    case 'item/fileChange/requestApproval':
      return { decision: 'decline' };
    case 'item/permissions/requestApproval':
      return { permissions: {}, scope: 'turn' };
    default:
      return undefined;
  }
}
