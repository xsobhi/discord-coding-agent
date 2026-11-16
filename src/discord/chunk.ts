const LIMIT = 1900;

/**
 * Splits text into Discord-sized messages. A split inside a code block closes
 * the fence and reopens it (same language) in the next piece.
 */
export function chunk(text: string, limit = LIMIT): string[] {
  const pieces: string[] = [];
  let current = '';
  let fence: string | null = null;

  const push = (): void => {
    if (!current.trim()) return;
    pieces.push(fence ? `${current}\n\`\`\`` : current);
    current = fence ? `${fence}\n` : '';
  };

  for (const rawLine of text.split('\n')) {
    for (const line of hardWrap(rawLine, limit - 20)) {
      if (current.length + line.length + 1 > limit - 8) push();
      current += current && !current.endsWith('\n') ? `\n${line}` : line;
      const marker = line.trimStart().match(/^```(\S*)/);
      if (marker) fence = fence ? null : `\`\`\`${marker[1]}`;
    }
  }
  if (current.trim()) pieces.push(current);
  return pieces;
}

function hardWrap(line: string, max: number): string[] {
  if (line.length <= max) return [line];
  const out: string[] = [];
  for (let i = 0; i < line.length; i += max) out.push(line.slice(i, i + max));
  return out;
}

export const clip = (text: string, max: number): string =>
  text.length <= max ? text : `${text.slice(0, max - 1)}…`;

export const oneLine = (text: string, max: number): string => clip(text.replace(/\s+/g, ' ').trim(), max);
