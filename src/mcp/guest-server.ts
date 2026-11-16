import { createSdkMcpServer } from '@anthropic-ai/claude-agent-sdk';
import type { Guest } from '../guests/guest.ts';
import { titleTool } from './discord-write.ts';
import { filesTool } from './guest-files.ts';
import type { ToolHost } from './util.ts';

/**
 * Everything a guest's agent can do beyond talking: rename its thread, and make
 * files in a remote sandbox if they are allowed to. No Discord reading, nothing
 * on the server.
 * Tools show up as mcp__guest__<name>.
 */
export function guestServer(host: ToolHost, guest: Guest) {
  return createSdkMcpServer({
    name: 'guest', version: '1.0.0',
    tools: [titleTool(host), ...(guest.files ? [filesTool(host)] : [])],
  });
}
