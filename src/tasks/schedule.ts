import { z } from 'zod';

const snowflake = z.string().regex(/^\d{5,25}$/);
const slot = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  day: z.number().int().min(0).max(6), // UTC: Sunday = 0
  time: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/),
  workMinutes: z.number().int().min(1).max(120),
  focus: z.string().min(1).max(300),
});
const plan = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  enabled: z.boolean(),
  ownerId: snowflake,
  threadId: snowflake,
  authorizationMessageId: snowflake,
  startsAt: z.iso.datetime(),
  endsAt: z.iso.datetime(),
  graceMinutes: z.number().int().min(1).max(1440),
  instructions: z.string().min(1).max(12000),
  slots: z.array(slot).max(14),
  activationCheckAt: z.iso.datetime().optional(),
}).superRefine((p, ctx) => {
  if (p.slots.reduce((n, s) => n + s.workMinutes, 0) > 600)
    ctx.addIssue({ code: 'custom', message: 'Weekly work budget exceeds 10 hours' });
  if (new Set(p.slots.map((s) => s.id)).size !== p.slots.length)
    ctx.addIssue({ code: 'custom', message: 'Duplicate slot id' });
  const span = Date.parse(p.endsAt) - Date.parse(p.startsAt);
  if (span <= 0 || span > 90 * 86400000)
    ctx.addIssue({ code: 'custom', message: 'Schedule must end within 90 days' });
});
export const schedulesSchema = z.array(plan).refine((ps) => new Set(ps.map((p) => p.id)).size === ps.length, 'Duplicate plan id');
export type Schedule = z.infer<typeof plan>;
export type Occurrence = { key: string; dueAt: number; workMinutes: number; focus: string; activation: boolean };

/** Only today's occurrence can run: downtime never generates a catch-up burst. */
export function occurrences(p: Schedule, now: number): Occurrence[] {
  if (!p.enabled || now >= Date.parse(p.endsAt)) return [];
  const out: Occurrence[] = [];
  if (p.activationCheckAt) out.push({ key: `${p.id}:activation`, dueAt: Date.parse(p.activationCheckAt),
    workMinutes: 0, focus: 'Verify automatic wake-up activation only; do not start a work session.', activation: true });
  const date = new Date(now);
  const day = date.toISOString().slice(0, 10);
  for (const s of p.slots) {
    if (s.day !== date.getUTCDay()) continue;
    const dueAt = Date.parse(`${day}T${s.time}:00.000Z`);
    if (dueAt < Date.parse(p.startsAt)) continue;
    out.push({ key: `${p.id}:${s.id}:${day}`, dueAt, workMinutes: s.workMinutes, focus: s.focus, activation: false });
  }
  return out.filter((o) => o.dueAt <= now && now - o.dueAt < (o.activation ? 86400000 : p.graceMinutes * 60000));
}

export function nextOccurrence(p: Schedule, now: number): string | null {
  if (!p.enabled) return null;
  const times: number[] = [];
  for (let offset = 0; offset <= 7; offset++) {
    const date = new Date(now + offset * 86400000);
    for (const s of p.slots.filter((s) => s.day === date.getUTCDay())) {
      const due = Date.parse(`${date.toISOString().slice(0, 10)}T${s.time}:00.000Z`);
      if (due > now && due >= Date.parse(p.startsAt) && due < Date.parse(p.endsAt)) times.push(due);
    }
  }
  return times.length ? new Date(Math.min(...times)).toISOString() : null;
}
