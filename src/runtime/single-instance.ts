import { createHash } from 'node:crypto';
import { createServer, type ListenOptions } from 'node:net';

/** A kernel-owned lease: crashes release it, and competing starts cannot both win. */
export function instanceAddress(clientId: string): string | ListenOptions {
  const hash = createHash('sha256').update(clientId).digest();
  if (process.platform === 'win32') return `\\\\.\\pipe\\discord-agent-${hash.toString('hex').slice(0, 24)}`;
  // Linux abstract socket: no file to clean up, no TCP port that could clash with other services, freed on exit.
  if (process.platform === 'linux') return `\0discord-agent-${hash.toString('hex').slice(0, 24)}`;
  return { host: '127.0.0.1', port: 20000 + hash.readUInt32BE(0) % 20000, exclusive: true };
}

export async function acquireInstance(clientId: string) {
  const status = { kind: 'discord-agent-instance', pid: process.pid, startedAt: new Date().toISOString(), ready: false };
  const server = createServer((socket) => {
    socket.on('error', () => undefined);
    socket.end(`${JSON.stringify(status)}\n`);
  });
  const address = instanceAddress(clientId);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(address, () => { server.removeListener('error', reject); resolve(); });
  }).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'EADDRINUSE') throw new Error('Another instance already owns this Discord bot; refusing to log in');
    throw error;
  });
  return {
    ready: () => { status.ready = true; },
    close: () => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
  };
}
