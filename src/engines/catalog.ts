import { errorText, log } from '../log.ts';
import { claudeModels } from './claude/models.ts';
import { codexModels } from './codex/models.ts';
import type { Engine } from './types.ts';

export type EffortOption = { value: string; description: string };
export type ModelOption = { value: string; label: string; description: string; efforts: EffortOption[]; defaultEffort?: string };

const TTL_MS = 60 * 60_000;
const cache = new Map<Engine, { at: number; models: ModelOption[] }>();
const inflight = new Map<Engine, Promise<ModelOption[]>>();

/** The models each engine offers on this account, as the CLIs report them (cached for an hour). */
export async function listModels(engine: Engine): Promise<ModelOption[]> {
  const hit = cache.get(engine);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.models;
  let pending = inflight.get(engine);
  if (!pending) {
    pending = (engine === 'claude' ? claudeModels() : codexModels())
      .then((models) => {
        cache.set(engine, { at: Date.now(), models });
        return models;
      })
      .catch((err) => {
        log.warn(`could not list ${engine} models`, errorText(err));
        return hit?.models ?? [];
      })
      .finally(() => inflight.delete(engine));
    inflight.set(engine, pending);
  }
  return pending;
}

/** Warm both lists at startup so the first /model answers inside Discord's 3 seconds. */
export function warmCatalog(): void {
  void listModels('claude');
  void listModels('codex');
}

export function cachedModels(engine: Engine): ModelOption[] {
  return cache.get(engine)?.models ?? [];
}

export const findModel = (models: ModelOption[], value: string): ModelOption | undefined =>
  models.find((m) => m.value === value);

/** An effort the model supports: keep the current one if it can, else the model's default. */
export function fitEffort(model: ModelOption | undefined, effort: string | undefined): string | undefined {
  if (!model || !model.efforts.length) return model ? undefined : effort;
  if (effort && model.efforts.some((e) => e.value === effort)) return effort;
  return model.defaultEffort ?? model.efforts[Math.floor(model.efforts.length / 2)]?.value;
}
