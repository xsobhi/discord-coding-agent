import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { occurrences, nextOccurrence, schedulesSchema, type Occurrence, type Schedule } from './schedule.ts';

const stateSchema = z.object({ runs: z.record(z.string(), z.object({
  at: z.string(), status: z.enum(['claimed', 'dispatched', 'skipped', 'failed']), note: z.string().optional(),
})) });
export type DispatchResult = { status: 'deferred' | 'dispatched' | 'skipped'; note?: string };
type Dispatch = (plan: Schedule, occurrence: Occurrence) => Promise<DispatchResult>;

/** Config is read-only to the runner. Receipts are separate, durable, and claimed before dispatch. */
export class ScheduleRunner {
  private readonly dir: string;
  private readonly dispatch: Dispatch;
  private checking = false;
  constructor(dir: string, dispatch: Dispatch) { this.dir = dir; this.dispatch = dispatch; }

  async tick(now = Date.now()): Promise<void> {
    if (this.checking) return;
    this.checking = true;
    try {
      const plans = schedulesSchema.parse(this.read('schedules.json', []));
      // Corrupt receipts fail closed: never silently reset deduplication after a restart.
      const state = stateSchema.parse(this.read('schedule-runs.json', { runs: {} }));
      for (const plan of plans) for (const occurrence of occurrences(plan, now)) {
        if (state.runs[occurrence.key]) continue;
        state.runs[occurrence.key] = { at: new Date(now).toISOString(), status: 'claimed' };
        this.write('schedule-runs.json', state);
        try {
          const result = await this.dispatch(plan, occurrence);
          if (result.status === 'deferred') delete state.runs[occurrence.key];
          else state.runs[occurrence.key] = { at: new Date(now).toISOString(), status: result.status, note: result.note };
        } catch {
          // Delivery may have reached the engine: don't replay an ambiguous send.
          state.runs[occurrence.key] = { at: new Date(now).toISOString(), status: 'failed', note: 'Dispatch failed; inspect the task before retrying' };
        }
        this.write('schedule-runs.json', state);
      }
      this.write('schedule-health.json', { checkedAt: new Date(now).toISOString(), pid: process.pid,
        plans: plans.map((p) => ({ id: p.id, enabled: p.enabled, threadId: p.threadId,
          nextWakeAt: nextOccurrence(p, now), weeklyWorkMinutes: p.slots.reduce((n, s) => n + s.workMinutes, 0) })) });
    } finally { this.checking = false; }
  }

  private read(name: string, fallback: unknown): unknown {
    try { return JSON.parse(readFileSync(join(this.dir, name), 'utf8')); }
    catch (err) { if ((err as NodeJS.ErrnoException).code === 'ENOENT') return fallback; throw err; }
  }
  private write(name: string, value: unknown): void {
    mkdirSync(this.dir, { recursive: true });
    const path = join(this.dir, name);
    writeFileSync(`${path}.tmp`, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
    renameSync(`${path}.tmp`, path);
  }
}
