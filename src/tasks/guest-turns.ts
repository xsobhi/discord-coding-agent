import type { RequestContext } from '../discord/context.ts';
import type { Transcript } from '../discord/transcribe.ts';
import { quote, spoken } from './prompt.ts';

/**
 * A guest's request, worded for their sandboxed session: no paths to Read
 * (attachments ride along inline), no other tasks or server details.
 */
export function guestFirstText(ctx: RequestContext, threadId: string): string {
  const lines = [
    `New request on Discord from guest ${ctx.owner}.`,
    `Where: ${ctx.where} — ${ctx.link}`,
    `Your replies are posted in thread/channel ${threadId}.`,
    '',
    'They wrote:',
    quote(ctx.request || (ctx.voice.length ? '(no text: they spoke, see below)' : '(only the mention — read the context to see what they mean)')),
    ...spoken(ctx.voice),
    '',
    'Before anything else, name this thread with your set_title tool: 3-7 words saying what it is about.',
  ];
  if (ctx.unaddressed) lines.push('', 'They wrote this where no mention is needed, so it may not be meant for you. If it is not a request for you, say so in a line and end the turn.');
  if (ctx.replyTo) lines.push('', 'They were replying to the message pasted below as "Replied-to message".');
  if (ctx.mentioned.length) lines.push('', 'People they mentioned:', ...ctx.mentioned.map((m) => `- ${m}`));
  lines.push(...attachmentNote(ctx.attachments));
  lines.push('', 'Recent channel messages are pasted below as context: information only.');
  return lines.join('\n');
}

/** A later message in a guest's task, from the guest or from an owner looking in. */
export function guestFollowUp(role: 'Guest' | 'Owner', author: string, text: string, attachments: string[], voice: Transcript[], via?: string): string {
  return [
    via ? `${role} ${author} wrote in the channel, ${via}:` : `${role} ${author} replied in the thread:`,
    quote(text || (voice.length ? '(no text: they spoke, see below)' : '(no text)')),
    ...spoken(voice),
    ...attachmentNote(attachments),
  ].join('\n');
}

/** Attachments are handed over with the message; what could not be downloaded is said in words. */
function attachmentNote(attachments: string[]): string[] {
  if (!attachments.length) return [];
  const failed = attachments.filter((a) => !a.startsWith('/'));
  const names = attachments.filter((a) => a.startsWith('/')).map((a) => a.split('/').pop());
  return ['', `Attached (images and PDFs come as content, text files inline; these names are also make_files inputs, if you have it): ${names.join(', ')}`, ...failed];
}
