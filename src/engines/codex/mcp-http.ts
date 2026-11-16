import { randomBytes } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { errorText, log } from '../../log.ts';

/**
 * Codex runs as its own process, so it cannot share the in-process MCP server
 * Claude gets. The bot serves the same tools over HTTP on 127.0.0.1 instead,
 * one unguessable path per task. Stateless: every request gets a fresh server.
 */
const routes = new Map<string, () => McpServer>();
let server: Server | undefined;
let port = 0;

async function listen(): Promise<void> {
  if (server) return;
  server = createServer((req, res) => void handle(req, res));
  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
  port = (server.address() as AddressInfo).port;
  log.info(`codex MCP bridge on 127.0.0.1:${port}`);
}

/** Registers a task's tools; returns the URL to give Codex and a function to remove it. */
export async function exposeTools(factory: () => McpServer): Promise<{ url: string; remove: () => void }> {
  await listen();
  const token = randomBytes(24).toString('hex');
  routes.set(token, factory);
  return { url: `http://127.0.0.1:${port}/mcp/${token}`, remove: () => routes.delete(token) };
}

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const token = req.url?.match(/^\/mcp\/([0-9a-f]{48})\/?$/)?.[1];
  const factory = token ? routes.get(token) : undefined;
  if (!factory) {
    res.writeHead(404).end();
    return;
  }
  if (req.method !== 'POST') {
    // Stateless: no server-initiated stream and no sessions to delete.
    res.writeHead(405, { allow: 'POST' }).end();
    return;
  }
  const mcp = factory();
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  res.on('close', () => {
    void transport.close();
    void mcp.close();
  });
  try {
    await mcp.connect(transport);
    await transport.handleRequest(req, res, await readJson(req));
  } catch (err) {
    log.warn('codex MCP request failed', errorText(err));
    if (!res.headersSent) res.writeHead(500).end();
  }
}

function readJson(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || 'null'));
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}
