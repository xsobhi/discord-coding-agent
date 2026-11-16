import type { Client, Message, SendableChannels } from 'discord.js';
import { config } from '../config.ts';
import { postText } from '../discord/send.ts';
import { guestFor } from '../guests/guest.ts';
import { openSession } from '../engines/open.ts';
import { activeChoice } from '../engines/settings.ts';
import { ENGINE_LABEL, type AgentSettings, type EngineSession, type OwnerTurn, type TurnEnd } from '../engines/types.ts';
import { errorText, log } from '../log.ts';
import { saveRecord, type TaskRecord } from '../store.ts';
import { handoffContext } from './handoff.ts';
import { IdleCloser } from './idle.ts';
import { Inbox } from './inbox.ts';
import { maybeRestart, ownerLabels, requestRestart } from './lifecycle.ts';
import { answerOrigin, MARK, type Outcome } from './origin.ts';
import { makeSink } from './sink.ts';
import { StatusBoard } from './status.ts';
import { retitle } from './title.ts';

/**
 * One request = one thread. Each turn runs on the task's engine (Claude Code
 * or Codex); the engine process stays up between turns for a while, then
 * exits, and a later owner message resumes its saved session.
 */
export class Task {
  readonly record: TaskRecord;
  readonly channel: SendableChannels;
  /** Owner messages on their way to the agent, and what became of them. */
  readonly inbox: Inbox;
  private readonly client: Client;
  /** The message that started the task; it gets the "done" reply. */
  private origin?: Message;
  private session?: EngineSession;
  private opening?: Promise<EngineSession>;
  /** Identifies the live session, so a closed one's late events are ignored. */
  private generation = 0;
  private current?: StatusBoard;
  private turnActive = false;
  private stoppedBy?: string;
  private readonly idle = new IdleCloser(() => this.closeSession());
  private watchdog?: NodeJS.Timeout;
  /** The owner who wrote last: questions and approvals ping them. */
  private driver?: string;
  footer = '';

  constructor(client: Client, record: TaskRecord, channel: SendableChannels, origin?: Message) {
    this.client = client;
    this.record = record;
    this.channel = channel;
    this.origin = origin;
    this.inbox = new Inbox(channel, record.threadId, () => this.current);
  }

  get busy(): boolean {
    return this.turnActive;
  }
  get deploymentBusy(): boolean { return this.turnActive || this.idle.background > 0 || Boolean(this.opening); }
  board(): StatusBoard | undefined { return this.current; }

  /** An owner's message: it starts a turn, or queues until the agent can read it, as in the CLI. */
  async send(turn: OwnerTurn, message?: Message): Promise<void> {
    if (message) this.driver = message.author.id;
    this.inbox.received(turn, message, this.turnActive);
    await this.deliver(turn);
  }

  private async deliver(turn: OwnerTurn): Promise<void> {
    const engine = this.record.agent.engine;
    const choice = activeChoice(this.record.agent);
    // Engine, model or effort changed since the last turn: drop the old process (never mid-turn).
    if (!this.turnActive && this.session && (this.session.engine !== engine || this.session.needsRestartFor(choice))) this.closeSession();
    const from = this.record.lastEngine;
    // Until a new session reports its exact model, show what was asked for.
    if (!this.session) this.footer = `${engine === 'claude' ? 'Claude' : 'Codex'} · ${choice.model}${choice.effort ? ` · ${choice.effort}` : ''}`;
    if (!this.turnActive) await this.beginTurn();
    try {
      if (from && from !== engine && !this.session) turn = { ...turn, pasted: [...turn.pasted, ...(await handoffContext(this.channel, from, engine))] };
      const session = await this.ensureSession();
      await session.send(turn, choice);
      this.record.lastEngine = session.engine;
      saveRecord(this.record);
    } catch (err) {
      log.error(`task ${this.record.id} could not start ${engine}`, errorText(err));
      await postText(this.channel, `⚠️ Could not start ${ENGINE_LABEL[engine]}: ${errorText(err)}`);
      this.inbox.dropAll();
      if (this.turnActive) await this.endTurn('failed', 'could not start');
    }
  }

  /** New engine/model/effort for this task. Takes effect on the next turn. */
  applySettings(next: AgentSettings): void {
    this.record.agent = next;
    saveRecord(this.record);
    if (!this.turnActive && this.session && this.session.engine !== next.engine) this.closeSession();
  }

  /** Interrupts the running turn. The session survives, so the owner can carry on. */
  async stop(by: string): Promise<boolean> {
    if (!this.turnActive || !this.session) return false;
    this.stoppedBy = by;
    this.current?.setPhase('working', `Stopping (asked by ${by})…`);
    await this.session.interrupt();
    return true;
  }

  /** "Read now" on a queued message: interrupt the step holding it back; the agent reads it next. */
  async readNow(by: string): Promise<boolean> {
    if (!this.turnActive || !this.inbox.waiting) return false;
    await this.inbox.interrupting(by);
    return this.stop(`${by} (to read new messages)`);
  }

  /** The engine began a turn on its own: a background job finished, or a message missed the last turn. */
  async engineTurnStarted(): Promise<void> {
    if (!this.turnActive) await this.beginTurn();
  }

  backgroundChanged(count: number): void {
    this.idle.background = count;
    maybeRestart();
  }

  /** Ends the engine process; its session can still be resumed later. */
  closeSession(): void {
    this.generation++;
    this.session?.close();
    this.session = undefined;
    this.opening = undefined;
  }

  private ensureSession(): Promise<EngineSession> {
    if (this.session) return Promise.resolve(this.session);
    if (this.opening) return this.opening;
    const engine = this.record.agent.engine;
    const generation = ++this.generation;
    const sink = makeSink(this, engine, () => generation === this.generation);
    this.opening = openSession(engine, {
      client: this.client, channel: this.channel, threadId: this.record.threadId, taskId: this.record.id,
      owners: ownerLabels(), resume: this.record.sessions[engine], requestRestart,
      driver: () => this.driver ?? this.record.ownerId, retitle: (title) => retitle(this.channel, this.record, title),
      sink, guest: guestFor(this.record, this.client),
    }, activeChoice(this.record.agent)).then((session) => {
      if (generation === this.generation) this.session = session;
      else session.close();
      this.opening = undefined;
      return session;
    }, (err) => {
      this.opening = undefined;
      throw err;
    });
    return this.opening;
  }

  /** Called by the live session's sink when its process is gone. */
  async sessionClosed(crash?: string): Promise<void> {
    this.session = undefined;
    this.idle.background = 0;
    this.inbox.dropAll();
    if (crash && this.turnActive) {
      await postText(this.channel, `⚠️ ${crash} Reply here to resume.`);
      await this.endTurn('failed', 'the engine process ended');
    }
  }

  async beginTurn(): Promise<void> {
    this.idle.cancel();
    this.turnActive = true;
    this.stoppedBy = undefined;
    this.current = new StatusBoard(this.channel, this.record.threadId);
    this.current.footer = this.footer;
    this.current.open();
    this.record.state = 'running';
    saveRecord(this.record);
    this.watchdog = setTimeout(() => void this.stop(`the ${config.turnMaxMinutes}-minute limit`), config.turnMaxMinutes * 60_000);
  }

  async turnEnded(end: TurnEnd): Promise<void> {
    if (end.errors?.length && !this.stoppedBy) await postText(this.channel, `⚠️ ${end.errors.slice(0, 3).join('\n')}`);
    const phase: Outcome = this.stoppedBy || end.status === 'interrupted' ? 'stopped' : end.status === 'done' ? 'done' : 'failed';
    const note = this.stoppedBy ? `Stopped by ${this.stoppedBy} · ${end.span}` : end.reason ? `${end.reason} · ${end.span}` : end.span;
    await this.endTurn(phase, note);
    if (end.more) await this.beginTurn();
    // Codex can drop input steered into a turn that was interrupted: send what it never read again.
    else if (this.session?.engine === 'codex') for (const turn of this.inbox.pending()) await this.deliver(turn);
  }

  private async endTurn(phase: Outcome, note: string): Promise<void> {
    if (this.watchdog) clearTimeout(this.watchdog);
    this.turnActive = false;
    await this.current?.finish(phase, note);
    this.record.state = 'idle';
    saveRecord(this.record);
    this.inbox.settle(MARK[phase]);
    const origin = this.origin;
    this.origin = undefined;
    if (origin) await answerOrigin(origin, this.record.threadId, this.record.ownThread, phase);
    this.idle.arm();
    maybeRestart();
  }
}
