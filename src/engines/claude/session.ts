import { query, type Query } from '@anthropic-ai/claude-agent-sdk';
import { errorText, log } from '../../log.ts';
import { sameChoice, type EngineChoice, type EngineSession, type OwnerTurn, type SessionHost } from '../types.ts';
import { InputQueue, sdkTurn } from './input.ts';
import { sessionOptions } from './options.ts';
import { handleMessage } from './stream.ts';

/** A Claude Code process (Agent SDK, streaming input) serving one task. */
export class ClaudeSession implements EngineSession {
  readonly engine = 'claude' as const;
  readonly choice: EngineChoice;
  private readonly host: SessionHost;
  private readonly input = new InputQueue();
  private readonly abort = new AbortController();
  private readonly q: Query;
  private turnActive = false;

  constructor(host: SessionHost, choice: EngineChoice) {
    this.host = host;
    this.choice = choice;
    this.q = query({ prompt: this.input, options: sessionOptions(host, choice, this.abort) });
    void this.pump();
  }

  /** The model and effort are fixed per process, so a change means resuming in a new one. */
  needsRestartFor(choice: EngineChoice): boolean {
    return !sameChoice(choice, this.choice);
  }

  async send(turn: OwnerTurn): Promise<void> {
    this.turnActive = true;
    this.input.push(sdkTurn(turn));
  }

  async interrupt(): Promise<void> {
    try {
      await this.q.interrupt();
    } catch (err) {
      log.warn('interrupt failed, aborting', errorText(err));
      this.abort.abort();
    }
  }

  close(): void {
    this.input.end();
    setTimeout(() => this.q.close(), 10_000).unref();
  }

  private async pump(): Promise<void> {
    const sink = this.host.sink;
    let crash: string | undefined;
    try {
      for await (const message of this.q) {
        const m = message as unknown as Lifecycle;
        if (m.type === 'command_lifecycle' && m.command_uuid && (m.state === 'started' || m.state === 'completed')) sink.onRead(m.command_uuid);
        // A background job that finishes after the turn ended starts a new turn by itself.
        if (!this.turnActive && startsTurn(m)) {
          this.turnActive = true;
          await sink.onTurnStart();
        }
        if (message.type === 'result') this.turnActive = (message.queued_turn_count ?? 0) > 0;
        await handleMessage(sink, message, this.choice.effort);
      }
    } catch (err) {
      // After an interrupt the SDK can throw once the turn is already settled; only a live turn is a crash.
      if (this.turnActive) crash = errorText(err);
      else log.info(`claude session for ${this.host.taskId} ended: ${errorText(err)}`);
    } finally {
      if (this.turnActive && !crash) crash = 'The Claude process ended unexpectedly.';
      this.turnActive = false;
      await sink.onClosed(crash);
    }
  }
}

/** The fields this file reads off stream messages the SDK's types don't list (command_lifecycle). */
type Lifecycle = { type: string; subtype?: string; state?: string; command_uuid?: string; parent_tool_use_id?: string | null };

const startsTurn = (m: Lifecycle): boolean =>
  (m.type === 'command_lifecycle' && m.state === 'started')
  || (m.type === 'system' && m.subtype === 'init')
  || (m.type === 'assistant' && !m.parent_tool_use_id);
