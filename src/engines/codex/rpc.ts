import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface } from 'node:readline';
import { errorText, log } from '../../log.ts';

type Json = Record<string, unknown>;
type Pending = { resolve: (v: unknown) => void; reject: (e: Error) => void; method: string };

/**
 * JSON-RPC over stdio to `codex app-server` (one JSON object per line, no
 * "jsonrpc" field). Codex sends notifications and also requests of its own
 * (approvals, questions) that must be answered.
 */
export class CodexRpc {
  private readonly proc: ChildProcessWithoutNullStreams;
  private readonly pending = new Map<number, Pending>();
  private nextId = 0;
  private exited = false;
  onNotification: (method: string, params: Json) => void = () => undefined;
  onRequest: (method: string, params: Json) => Promise<unknown> = async () => {
    throw new Error('unsupported');
  };
  onExit: (reason: string) => void = () => undefined;

  private constructor() {
    this.proc = spawn('codex', ['app-server'], { stdio: ['pipe', 'pipe', 'pipe'], env: process.env });
    createInterface({ input: this.proc.stdout }).on('line', (line) => this.receive(line));
    createInterface({ input: this.proc.stderr }).on('line', (line) => {
      const plain = line.replace(/\x1b\[[0-9;]*m/g, '');
      if (/\bERROR\b/.test(plain) && !plain.includes('bubblewrap')) log.warn('[codex]', plain.slice(0, 400));
    });
    this.proc.on('exit', (code, signal) => {
      this.exited = true;
      const reason = signal ? `signal ${signal}` : `exit code ${code}`;
      for (const p of this.pending.values()) p.reject(new Error(`codex app-server ended (${reason}) during ${p.method}`));
      this.pending.clear();
      this.onExit(reason);
    });
    this.proc.on('error', (err) => log.error('codex spawn failed', errorText(err)));
  }

  static async start(): Promise<CodexRpc> {
    const rpc = new CodexRpc();
    await rpc.call('initialize', {
      clientInfo: { name: 'discord-agent', title: 'Discord agent', version: '1.0.0' },
      capabilities: { experimentalApi: true, requestAttestation: false },
    });
    rpc.notify('initialized');
    return rpc;
  }

  call<T = Json>(method: string, params: unknown = {}): Promise<T> {
    if (this.exited) return Promise.reject(new Error('codex app-server is not running'));
    const id = ++this.nextId;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject, method });
      this.write({ id, method, params });
    });
  }

  notify(method: string, params?: unknown): void {
    this.write(params === undefined ? { method } : { method, params });
  }

  close(): void {
    if (!this.exited) this.proc.kill('SIGTERM');
  }

  private write(message: Json): void {
    if (!this.exited) this.proc.stdin.write(`${JSON.stringify(message)}\n`);
  }

  private receive(line: string): void {
    let m: Json;
    try {
      m = JSON.parse(line);
    } catch {
      return;
    }
    const id = m.id as number | string | undefined;
    if (id !== undefined && typeof m.method !== 'string') {
      const p = this.pending.get(id as number);
      this.pending.delete(id as number);
      const error = m.error as { message?: string } | undefined;
      if (error) p?.reject(new Error(`${p.method}: ${error.message ?? JSON.stringify(error)}`));
      else p?.resolve(m.result);
      return;
    }
    if (typeof m.method !== 'string') return;
    const params = (m.params ?? {}) as Json;
    if (id === undefined) {
      this.onNotification(m.method, params);
      return;
    }
    this.onRequest(m.method, params).then(
      (result) => this.write({ id, result }),
      (err) => this.write({ id, error: { code: -32601, message: errorText(err) } }),
    );
  }
}
