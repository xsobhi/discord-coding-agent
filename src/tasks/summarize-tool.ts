import { oneLine } from '../discord/chunk.ts';

type Input = Record<string, unknown>;
const str = (v: unknown): string => (typeof v === 'string' ? v : v === undefined ? '' : JSON.stringify(v));
const short = (path: unknown): string => str(path).replace(/^\/home\/ubuntu\//, '~/');

/** One line describing a tool call, for the status board. */
export function summarizeTool(name: string, input: Input): string {
  const detail = describeInput(name, input);
  return detail ? `${label(name)} ${oneLine(detail, 140)}` : label(name);
}

function label(name: string): string {
  const mcp = name.match(/^mcp__(.+?)__(.+)$/);
  return mcp ? `\`${mcp[1]}:${mcp[2]}\`` : `\`${name}\``;
}

function describeInput(name: string, input: Input): string {
  switch (name) {
    case 'Bash':
      return str(input.description) || str(input.command);
    case 'Read':
    case 'Write':
    case 'Edit':
    case 'NotebookEdit':
      return short(input.file_path ?? input.notebook_path);
    case 'Grep':
    case 'Glob':
      return `${str(input.pattern)}${input.path ? ` in ${short(input.path)}` : ''}`;
    case 'WebFetch':
      return str(input.url);
    case 'WebSearch':
      return str(input.query);
    case 'Agent':
    case 'Task':
      return str(input.description);
    case 'TodoWrite':
      return 'updating the plan';
    case 'AskUserQuestion':
      return 'asking you a question';
    default:
      return firstString(input);
  }
}

function firstString(input: Input): string {
  for (const value of Object.values(input)) if (typeof value === 'string' && value.trim()) return value;
  return '';
}

/** The full input for an approval prompt: the command or path, then the rest. */
export function approvalDetail(name: string, input: Input): string {
  if (name === 'Bash') return `${str(input.command)}${input.description ? `\n# ${str(input.description)}` : ''}`;
  if (name === 'Write') return `${str(input.file_path)}\n---\n${str(input.content)}`;
  if (name === 'Edit') return `${str(input.file_path)}\n--- old\n${str(input.old_string)}\n--- new\n${str(input.new_string)}`;
  return JSON.stringify(input, null, 2);
}
