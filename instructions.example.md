<!--
Copy to instructions.md (gitignored) and edit. It is appended to the agent's system prompt on every new
task, so changes apply without a restart. Everything here is addressed to the agent, and only owners can
change this file, so it is a trusted place for rules. Keep it short and concrete. Delete this comment.
-->

## About this machine
- This is a <describe it: a home server, a VPS, a work laptop>. Apps run under <PM2 / systemd / Docker>.
- My projects live in `~/projects`. Each has a README with how it deploys.
- Logs: `journalctl -u <service> -n 200 --no-pager`, or `pm2 logs <name> --lines 200 --nostream`.

## Rules for this machine
- Never touch `~/projects/billing` without asking me first.
- Do not restart the database service. If it needs a restart, ask in the thread.
- Do not push to `main` of any repository unless I asked for it in the same task.

## What to be careful with
- Anything that emails, messages or posts to a public place needs my explicit ask in the task.
- Production deploys: run the tests first and tell me what you ran.

## How I like answers
- Short summaries. Put the answer first, the details after.
