import assert from 'node:assert/strict';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createConnection } from 'node:net';
import { fileURLToPath } from 'node:url';
import { acquireInstance, instanceAddress } from '../src/runtime/single-instance.ts';

if (process.argv[2] === '--child') {
  try {
    const lease = await acquireInstance(process.argv[3]!);
    lease.ready();
    console.log(JSON.stringify({ acquired: true, pid: process.pid }));
    process.stdin.once('data', () => { void lease.close().then(() => process.exit(0)); });
  } catch (error) {
    console.log(JSON.stringify({ acquired: false, error: String(error) }));
    process.exit(23);
  }
} else {
  const key = `offline-test-${randomUUID()}`;
  type Result = { acquired: boolean; pid?: number; error?: string };
  type Fixture = { child: ChildProcessWithoutNullStreams; exited: Promise<number | null>; result: Promise<Result> };
  const children: Fixture[] = [];
  function launch(): Fixture {
    const child = spawn(process.execPath, [fileURLToPath(import.meta.url), '--child', key], {
      stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true,
    });
    const exited = new Promise<number | null>((resolve) => child.once('exit', resolve));
    const result = new Promise<Result>((resolve, reject) => {
      let output = '';
      const timer = setTimeout(() => reject(new Error('test child startup timed out')), 10000);
      child.once('error', reject);
      child.stdout.on('data', (data) => {
        output += String(data);
        if (!output.includes('\n')) return;
        clearTimeout(timer);
        resolve(JSON.parse(output.split('\n')[0]!));
      });
    });
    const fixture = { child, exited, result };
    children.push(fixture);
    return fixture;
  }
  try {
    const racers = [launch(), launch(), launch(), launch()];
    const results = await Promise.all(racers.map((fixture) => fixture.result));
    assert.equal(results.filter((result) => result.acquired).length, 1, 'only one simultaneous start acquires');
    const winner = racers[results.findIndex((result) => result.acquired)]!;
    for (const [index, result] of results.entries()) {
      if (!result.acquired) {
        assert.match(result.error!, /Another instance already owns/);
        assert.equal(await racers[index]!.exited, 23);
      }
    }
    const health = await new Promise<string>((resolve, reject) => {
      const address = instanceAddress(key);
      const socket = typeof address === 'string' ? createConnection(address) : createConnection(address as { port: number; host: string });
      let text = '';
      socket.on('error', reject).on('data', (data) => { text += String(data); }).on('end', () => resolve(text));
    });
    assert.equal(JSON.parse(health).pid, winner.child.pid);
    assert.equal(JSON.parse(health).ready, true);
    winner.child.kill(); // Only this disposable test child, never the bot.
    await winner.exited;
    const afterCrash = launch();
    assert.equal((await afterCrash.result).acquired, true, 'crashed owner releases its lease');
    afterCrash.child.stdin.end('close\n');
    assert.equal(await afterCrash.exited, 0);
    const afterClose = launch();
    assert.equal((await afterClose.result).acquired, true, 'graceful close releases its lease');
    afterClose.child.stdin.end('close\n');
    assert.equal(await afterClose.exited, 0);
    console.log('single-instance: concurrent starts, health, crash recovery and graceful restart passed');
  } finally {
    for (const fixture of children) if (fixture.child.exitCode === null && fixture.child.signalCode === null) fixture.child.kill();
    await Promise.all(children.map((fixture) => fixture.exited));
  }
}
