import type { CanUseTool, PermissionResult, PermissionUpdate } from '@anthropic-ai/claude-agent-sdk';
import type { SendableChannels } from 'discord.js';
import { askOwners } from '../../agent/approvals.ts';
import { askQuestions } from '../../agent/questions.ts';
import { approvalDetail } from '../../tasks/summarize-tool.ts';

/** What the permission relay needs from a running task. */
export type PermissionHost = {
  channel: SendableChannels;
  threadId: string;
  /** The owner to ping on a question or approval. */
  ping(): string | undefined;
  waiting(note: string): void;
  working(): void;
};

/**
 * Auto mode decides almost everything itself. This runs only when its
 * classifier cannot, and for AskUserQuestion: both go to the owners in Discord.
 */
export function makeCanUseTool(host: PermissionHost): CanUseTool {
  return async (toolName, input, opts): Promise<PermissionResult> => {
    if (toolName === 'AskUserQuestion') return answerQuestions(host, input, opts.signal);

    host.waiting(`Approval needed: ${toolName}`);
    const rules = taskWideRules(opts.suggestions);
    const outcome = await askOwners(host.channel, {
      title: opts.title ?? `Claude wants to use ${toolName}`,
      detail: approvalDetail(toolName, input),
      reason: [opts.description, opts.decisionReason].filter(Boolean).join(' — ') || undefined,
      offerTaskWide: rules.length > 0,
    }, opts.signal, host.ping());
    host.working();

    if (outcome.verdict === 'deny') {
      return { behavior: 'deny', message: `An owner did not approve this (${outcome.note}). Do not retry it; find another way or ask in the thread.` };
    }
    return {
      behavior: 'allow',
      updatedInput: input,
      ...(outcome.verdict === 'task' ? { updatedPermissions: rules } : {}),
    };
  };
}

export async function answerQuestions(host: PermissionHost, input: Record<string, unknown>, signal: AbortSignal): Promise<PermissionResult> {
  const questions = Array.isArray(input.questions) ? input.questions : [];
  host.waiting('Waiting for your answer');
  const answers = await askQuestions(host.channel, host.threadId, questions, signal, host.ping());
  host.working();
  if (!answers) return { behavior: 'deny', message: 'Nobody answered. Continue with your best judgement or wait for them in the thread.' };
  return { behavior: 'allow', updatedInput: { ...input, answers } };
}

/**
 * "Approve for this task" keeps only rule and directory grants, scoped to this
 * session. A suggestion to change the permission mode is never applied.
 */
function taskWideRules(suggestions: PermissionUpdate[] | undefined): PermissionUpdate[] {
  return (suggestions ?? [])
    .filter((s) => s.type === 'addRules' || s.type === 'addDirectories')
    .map((s) => ({ ...s, destination: 'session' as const }));
}
