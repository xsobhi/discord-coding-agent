import { query } from '@anthropic-ai/claude-agent-sdk';
import { config } from '../../config.ts';
import type { ModelOption } from '../catalog.ts';
import { InputQueue } from './input.ts';

const EFFORT_TEXT: Record<string, string> = {
  low: 'Quickest, for simple jobs',
  medium: 'Balanced',
  high: 'Thinks things through',
  xhigh: 'Deeper reasoning for hard problems',
  max: 'Deepest reasoning, slowest',
};

/** Asks a short-lived Claude Code process which models this account can use. */
export async function claudeModels(): Promise<ModelOption[]> {
  const input = new InputQueue();
  const q = query({ prompt: input, options: { cwd: config.cwd, permissionMode: 'auto' } });
  try {
    const models = await q.supportedModels();
    return models
      .filter((m) => m.value !== 'default')
      .map((m) => ({
        value: m.value,
        label: m.displayName,
        description: m.description,
        efforts: (m.supportedEffortLevels ?? []).map((e) => ({ value: e, description: EFFORT_TEXT[e] ?? e })),
      }));
  } finally {
    input.end();
    q.close();
  }
}
