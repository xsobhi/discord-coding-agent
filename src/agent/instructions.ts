import { readFileSync } from 'node:fs';

/** The operator's own notes for the agent. Read on every new task, so edits apply without a restart. Empty when absent. */
export function readInstructions(path: string): string {
  try {
    return readFileSync(path, 'utf8').trim();
  } catch {
    return '';
  }
}
