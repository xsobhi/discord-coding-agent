import { readFileSync, statSync } from 'node:fs';
import { basename, extname } from 'node:path';

/**
 * A guest's agent has no Read tool, so the bot itself hands over what they
 * attached: images and PDFs as content blocks, small text files as text.
 * Only paths the bot saved for this message ever get here.
 */
type Block =
  | { type: 'text'; text: string }
  | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } }
  | { type: 'document'; source: { type: 'base64'; media_type: 'application/pdf'; data: string }; title: string };

const IMAGE: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp' };
const TEXT = new Set(['.txt', '.csv', '.tsv', '.sps', '.md', '.json', '.r', '.py', '.sql', '.html', '.xml', '.log', '.tex', '.js', '.ts', '.java', '.c', '.cpp']);
const MAX_IMAGE = 5 << 20;
const MAX_PDF = 20 << 20;
const MAX_TEXT = 100_000;

/** Content blocks for the files the model can take, and a note for each it cannot. */
export function inlineBlocks(paths: string[]): Block[] {
  const blocks: Block[] = [];
  for (const path of paths.filter((p) => p.startsWith('/'))) {
    const name = basename(path).replace(/^\d+-/, '');
    const ext = extname(path).toLowerCase();
    let size = 0;
    try { size = statSync(path).size; } catch { continue; }
    if (IMAGE[ext] && size <= MAX_IMAGE) {
      blocks.push({ type: 'image', source: { type: 'base64', media_type: IMAGE[ext]!, data: readFileSync(path).toString('base64') } });
    } else if (ext === '.pdf' && size <= MAX_PDF) {
      blocks.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: readFileSync(path).toString('base64') }, title: name });
    } else if (TEXT.has(ext) && size <= MAX_TEXT) {
      blocks.push({ type: 'text', text: `Attached file ${name}:\n\`\`\`\n${readFileSync(path, 'utf8')}\n\`\`\`` });
    } else {
      blocks.push({ type: 'text', text: `(Attached ${name}, ${Math.ceil(size / 1024)} KB: not readable directly. With make_files, pass it as an input and open it in code; otherwise ask for a screenshot, a PDF or the text pasted in.)` });
    }
  }
  return blocks;
}

/** Codex takes images as its own input and nothing else: the text and notes go in the message. */
export function inlineText(paths: string[]): string {
  return inlineBlocks(paths.filter((p) => !IMAGE[extname(p).toLowerCase()]))
    .map((b) => (b.type === 'text' ? b.text : `(Attached ${b.type === 'document' ? b.title : 'file'}: this engine cannot read PDFs. Ask for screenshots or switch to Claude.)`))
    .join('\n\n');
}
