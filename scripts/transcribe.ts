// Transcribe any audio file on this machine the way the bot does its voice notes
// (HTTP backend from TRANSCRIBE_URL, then local whisper from AGENT_WHISPER_PYTHON), with no length or format limit:
//   node scripts/transcribe.ts [--lyrics] <file> [<file> ...]
// --lyrics keeps sung vocals, which the voice filter otherwise drops as non-speech.
import { transcribe } from '../src/discord/transcribe.ts';

const args = process.argv.slice(2);
const lyrics = args.includes('--lyrics');
const files = args.filter((a) => a !== '--lyrics');
if (!files.length) {
  console.error('usage: node scripts/transcribe.ts [--lyrics] <audio file> [...]');
  process.exit(2);
}
for (const file of files) {
  const t = await transcribe(file, Infinity, lyrics);
  console.log(`# ${file} (${t.note})\n${t.text || '(no speech)'}\n`);
}
