import type { ModelOption } from '../catalog.ts';
import { CodexRpc } from './rpc.ts';

type CodexModel = {
  model: string;
  displayName: string;
  description: string;
  hidden: boolean;
  supportedReasoningEfforts: { reasoningEffort: string; description: string }[];
  defaultReasoningEffort: string;
};

/** Asks a short-lived `codex app-server` for the models this ChatGPT account can use. */
export async function codexModels(): Promise<ModelOption[]> {
  const rpc = await CodexRpc.start();
  try {
    const out: ModelOption[] = [];
    let cursor: string | null = null;
    do {
      const page: { data: CodexModel[]; nextCursor: string | null } = await rpc.call('model/list', cursor ? { cursor } : {});
      for (const m of page.data) {
        if (m.hidden) continue;
        out.push({
          value: m.model,
          label: m.displayName,
          description: m.description,
          efforts: m.supportedReasoningEfforts.map((e) => ({ value: e.reasoningEffort, description: e.description })),
          defaultEffort: m.defaultReasoningEffort,
        });
      }
      cursor = page.nextCursor;
    } while (cursor);
    return out;
  } finally {
    await rpc.close();
  }
}
