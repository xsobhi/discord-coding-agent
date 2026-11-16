import { tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { askQuestions } from '../agent/questions.ts';
import { fail, guard, ok, signalOf, type ToolHost } from './util.ts';

/**
 * A pick among more choices than AskUserQuestion's four: every choice is its own button, five a row, up to 25.
 */
export function pickTools(host: ToolHost) {
  return [
    tool('ask_pick',
      'Ask the owners to pick one of more than 4 choices (up to 25), each its own button - e.g. every number on a picture sheet you just posted with post_file. With `why` (default on) a press opens a box for their reason, optional; the answer is "<label>" or "<label> (why: ...)" - pass that reason on to whatever learns from the pick. Waits for an owner\'s press; a message they write instead comes back as the answer. Use AskUserQuestion when 4 choices are enough and no reason is wanted.',
      {
        question: z.string().min(3).max(240),
        header: z.string().max(12).optional(),
        options: z.array(z.object({ label: z.string().min(1).max(80), description: z.string().max(100).optional() })).min(2).max(25),
        why: z.boolean().optional(),
      },
      (a, extra) => guard(async () => {
        const answers = await askQuestions(host.channel, host.threadId, [{ question: a.question, header: a.header, options: a.options, why: a.why ?? true }],
          signalOf(extra), host.driver?.());
        if (!answers) return fail('Nobody answered. Continue with your best judgement or ask again later.');
        return ok(`Answer: ${answers[a.question]}`);
      }), { alwaysLoad: true }),
  ];
}
