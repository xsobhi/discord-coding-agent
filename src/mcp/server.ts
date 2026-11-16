import { createSdkMcpServer } from '@anthropic-ai/claude-agent-sdk';
import { directoryTools } from './discord-directory.ts';
import { pickTools } from './discord-pick.ts';
import { messageTools } from './discord-read.ts';
import { historyTools } from './history.ts';
import { writeTools } from './discord-write.ts';
import type { ToolHost } from './util.ts';

export type { ToolHost } from './util.ts';

/** In-process MCP server for one task; its tools show up as mcp__discord__<name>. */
export function discordServer(host: ToolHost) {
  return createSdkMcpServer({
    name: 'discord',
    version: '1.0.0',
    tools: [...messageTools(host), ...directoryTools(host), ...writeTools(host), ...pickTools(host), ...historyTools()],
  });
}
