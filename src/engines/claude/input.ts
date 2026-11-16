import type { SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import { inlineBlocks } from '../../guests/inline.ts';
import type { OwnerTurn } from '../types.ts';

/**
 * The prompt stream for one Claude session. Owner messages are pushed in as
 * they arrive; ending the queue lets the session finish and its process exit.
 */
export class InputQueue implements AsyncIterable<SDKUserMessage> {
  private items: SDKUserMessage[] = [];
  private waiters: ((r: IteratorResult<SDKUserMessage>) => void)[] = [];
  private ended = false;

  push(message: SDKUserMessage): void {
    if (this.ended) return;
    const waiter = this.waiters.shift();
    if (waiter) waiter({ value: message, done: false });
    else this.items.push(message);
  }

  end(): void {
    this.ended = true;
    for (const waiter of this.waiters.splice(0)) waiter({ value: undefined, done: true });
  }

  [Symbol.asyncIterator](): AsyncIterator<SDKUserMessage> {
    return {
      next: () => {
        const item = this.items.shift();
        if (item) return Promise.resolve({ value: item, done: false });
        if (this.ended) return Promise.resolve({ value: undefined, done: true });
        return new Promise((resolve) => this.waiters.push(resolve));
      },
    };
  }
}

/**
 * An owner's words as a human turn. Anything they did not write themselves
 * (channel history, the message they replied to) goes in `pasted_content`,
 * which Claude Code marks as pasted text that may carry instructions nobody gave.
 */
export function sdkTurn(turn: OwnerTurn): SDKUserMessage {
  // A guest task's attachments come inline: its agent cannot Read paths.
  const content = turn.files?.length ? [{ type: 'text' as const, text: turn.text }, ...inlineBlocks(turn.files)] : turn.text;
  return {
    type: 'user',
    message: { role: 'user', content: content as SDKUserMessage['message']['content'] },
    parent_tool_use_id: null,
    // The uuid comes back on command_lifecycle events: 'started' is when Claude has read it.
    uuid: turn.id as SDKUserMessage['uuid'],
    origin: { kind: 'human' },
    ...(turn.pasted.length ? { pasted_content: turn.pasted } : {}),
  };
}
