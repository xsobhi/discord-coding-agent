import { askOwners } from '../../agent/approvals.ts';
import { askQuestions } from '../../agent/questions.ts';
import type { SessionHost } from '../types.ts';
import { plainCommand } from './events.ts';
import { guestAnswer } from './guest.ts';

type Json = Record<string, any>;

/**
 * Requests Codex sends to the client. With auto review on, its reviewer
 * decides almost every approval itself; anything that still reaches us goes
 * to the owners as buttons, exactly like Claude's undecided auto-mode calls.
 */
export async function answerCodexRequest(host: SessionHost, method: string, p: Json, signal: AbortSignal): Promise<unknown> {
  // A guest's task never escalates to the owners: its own tools run, anything that would touch the machine is declined.
  const answered = host.guest ? guestAnswer(method, p) : undefined;
  if (answered) return answered;
  switch (method) {
    case 'item/commandExecution/requestApproval': {
      const verdict = await ask(host, 'Codex wants to run a command', plainCommand(String(p.command ?? '(no command shown)')), p.reason, signal);
      return { decision: verdict === 'once' ? 'accept' : verdict === 'task' ? 'acceptForSession' : 'decline' };
    }
    case 'item/fileChange/requestApproval': {
      const detail = p.grantRoot ? `write access under ${p.grantRoot}` : 'apply a file change';
      const verdict = await ask(host, 'Codex wants to change files', detail, p.reason, signal);
      return { decision: verdict === 'once' ? 'accept' : verdict === 'task' ? 'acceptForSession' : 'decline' };
    }
    case 'item/permissions/requestApproval': {
      const verdict = await ask(host, 'Codex wants extra permissions', JSON.stringify(p.permissions, null, 2), p.reason, signal);
      if (verdict === 'deny') return { permissions: {}, scope: 'turn' };
      return { permissions: p.permissions ?? {}, scope: verdict === 'task' ? 'session' : 'turn' };
    }
    case 'item/tool/requestUserInput':
      return answerQuestions(host, p, signal);
    case 'mcpServer/elicitation/request':
      return { action: 'decline', content: null, _meta: null };
    default:
      throw new Error(`discord-agent does not handle ${method}`);
  }
}

async function ask(host: SessionHost, title: string, detail: string, reason: string | undefined, signal: AbortSignal) {
  host.sink.waiting(title);
  const outcome = await askOwners(host.channel, { title, detail, reason, offerTaskWide: true }, signal, host.driver());
  host.sink.working();
  return outcome.verdict;
}

async function answerQuestions(host: SessionHost, p: Json, signal: AbortSignal): Promise<unknown> {
  const questions = (p.questions ?? []) as Json[];
  host.sink.waiting('Waiting for your answer');
  const answers = await askQuestions(host.channel, host.threadId, questions.map((q) => ({
    question: String(q.question),
    header: q.header,
    options: (q.options ?? []).map((o: Json) => ({ label: String(o.label), description: o.description })),
  })), signal, host.driver());
  host.sink.working();
  const out: Record<string, { answers: string[] }> = {};
  questions.forEach((q) => {
    const answer = answers?.[String(q.question)];
    if (answer !== undefined) out[q.id] = { answers: [answer] };
  });
  return { answers: out };
}
