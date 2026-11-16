import type { SDKMessage, SDKResultMessage } from '@anthropic-ai/claude-agent-sdk';
import { config } from '../../config.ts';
import { oneLine } from '../../discord/chunk.ts';
import { log } from '../../log.ts';
import { summarizeTool } from '../../tasks/summarize-tool.ts';
import type { EngineSink, TurnEnd } from '../types.ts';

type Block = { type: string; text?: string; name?: string; input?: Record<string, unknown> };

/** Turns the Agent SDK's message stream into thread posts and status-board lines. */
export async function handleMessage(sink: EngineSink, message: SDKMessage, effort?: string): Promise<void> {
  switch (message.type) {
    case 'system':
      return handleSystem(sink, message, effort);
    case 'assistant': {
      const blocks = message.message.content as Block[];
      const nested = message.parent_tool_use_id !== null;
      for (const block of blocks) {
        if (block.type === 'tool_use' && block.name) {
          sink.board()?.action(`${nested ? '↳ ' : ''}${summarizeTool(block.name, block.input ?? {})}`);
        } else if (block.type === 'text' && block.text?.trim() && !nested) {
          await sink.onText(block.text);
        }
      }
      return;
    }
    case 'result':
      return sink.onTurnEnd(turnEnd(message));
    default:
      return;
  }
}

function handleSystem(sink: EngineSink, message: SDKMessage & { type: 'system' }, effort?: string): void {
  const m = message as unknown as Record<string, unknown>;
  switch (m.subtype) {
    case 'init': {
      const mode = String(m.permissionMode);
      // Only guest tasks run in default mode: no shell or files, and whatever else they reach for is refused.
      const footer = `Claude · ${m.model}${effort ? ` · ${effort}` : ''} · ${mode === 'default' ? 'guest' : mode === 'bypassPermissions' ? 'bypass' : mode} mode`;
      const expected = config.permissionMode === 'bypass' ? 'bypassPermissions' : 'auto';
      const warning = mode === expected || mode === 'default' ? undefined
        : `⚠️ This session started in **${mode}** mode, not ${expected} mode.`;
      sink.onSession(String(m.session_id), footer, warning);
      return;
    }
    case 'permission_denied':
      sink.board()?.push(`⛔ auto mode blocked \`${m.tool_name}\`${m.decision_reason ? `: ${oneLine(String(m.decision_reason), 160)}` : ''}`);
      return;
    case 'compact_boundary':
      sink.board()?.push('🗜️ conversation compacted');
      return;
    case 'background_tasks_changed':
      sink.onBackground(Array.isArray(m.tasks) ? m.tasks.length : 0);
      return;
    case 'api_retry':
      sink.board()?.push(`⏳ API retry ${m.attempt ?? ''}`.trim());
      return;
    default:
      if (m.subtype === 'model_refusal_no_fallback') log.warn('model refusal', JSON.stringify(m).slice(0, 300));
  }
}

function turnEnd(result: SDKResultMessage): TurnEnd {
  const minutes = Math.round(result.duration_ms / 60000);
  const span = `${result.num_turns} turns · ${minutes < 1 ? '<1' : minutes} min`;
  const more = (result.queued_turn_count ?? 0) > 0;
  if (result.subtype === 'success' && !result.is_error) return { status: 'done', span, more };
  const why: Record<string, string> = {
    error_max_turns: 'hit the turn limit',
    error_max_budget_usd: 'hit the budget limit',
    error_during_execution: 'stopped with an error',
  };
  const errors = result.subtype === 'success' ? [] : result.errors ?? [];
  return { status: 'failed', span, reason: why[result.subtype] ?? result.subtype, errors, more };
}
