import { randomUUID } from 'node:crypto';
import type { Client } from 'discord.js';
import { config, isOwner } from '../config.ts';
import { errorText, log } from '../log.ts';
import { getRecord } from '../store.ts';
import { trackActivity } from './lifecycle.ts';
import { busyCount, otherTasks, taskIn } from './registry.ts';
import { ScheduleRunner, type DispatchResult } from './schedule-runner.ts';
import type { Occurrence, Schedule } from './schedule.ts';

/** Resume the real saved task, never create a synthetic Discord owner message. */
export async function dispatchWake(client: Client, plan: Schedule, occurrence: Occurrence): Promise<DispatchResult> {
  const record = getRecord(plan.threadId);
  if (!isOwner(plan.ownerId) || !record || record.state === 'closed' || record.ownerId !== plan.ownerId)
    return { status: 'skipped', note: 'Owner revoked or original task unavailable' };
  const task = await taskIn(client, plan.threadId);
  if (!task) return { status: 'deferred', note: 'Thread temporarily unavailable' };
  // The real owner's scheduling request is provenance, not an instruction invented by a bot post.
  const approval = await task.channel.messages.fetch(plan.authorizationMessageId).catch(() => null);
  if (!approval) return { status: 'deferred', note: 'Scheduling request temporarily unavailable' };
  if (approval.author.bot || approval.author.id !== plan.ownerId)
    return { status: 'skipped', note: 'Owner scheduling request could not be verified' };
  const current = getRecord(plan.threadId);
  if (current?.state === 'closed' || current !== record)
    return { status: 'skipped', note: 'Task retired while checking the scheduling request' };
  if (task.deploymentBusy || busyCount() >= config.maxConcurrent)
    return { status: 'deferred', note: 'Task or concurrency limit busy' };
  const text = [
    `Scheduled continuation of the task authorized by owner ${plan.ownerId}.`,
    `Scheduling request: https://discord.com/channels/${record.guildId ?? '@me'}/${plan.threadId}/${plan.authorizationMessageId}`,
    `Wake-up: ${occurrence.key}; scheduled ${new Date(occurrence.dueAt).toISOString()}.`,
    `Focus: ${occurrence.focus}. Work budget for this wake-up: ${occurrence.workMinutes} minutes.`,
    'This is an automatic wake-up, not a new message typed by the owner. Follow the existing authorized task and any newer owner instructions.',
    occurrence.activation
      ? `Activation check only: inspect schedule-health.json and schedule-runs.json in ${config.dataDir}. Confirm this real resumed turn proves wake-up delivery, report the next scheduled wake-up, then end. Do not do the scheduled work during this check.`
      : plan.instructions,
    `Other running tasks (avoid shared files/services): ${JSON.stringify(otherTasks(plan.threadId))}`,
  ].join('\n\n');
  // No awaits between the final busy check and send: Task.beginTurn reserves this task synchronously.
  await task.send({ id: randomUUID(), text, pasted: [], images: [] });
  log.info(`schedule ${occurrence.key}: dispatched to ${plan.threadId}`);
  return { status: 'dispatched' };
}

export function startScheduledWakes(client: Client): void {
  const runner = new ScheduleRunner(config.dataDir, (p, o) => dispatchWake(client, p, o));
  const check = (): void => {
    void trackActivity(() => runner.tick()).catch((err) => log.error('scheduled wake-up', errorText(err)));
  };
  check();
  setInterval(check, 30_000).unref();
  log.info('scheduled wake-ups: checking durable owner schedules every 30 seconds');
}
