# Security policy

This project gives an AI agent a shell on the machine it runs on, so security reports matter.

## Reporting a vulnerability

Please report it privately through GitHub security advisories: open the repository's **Security** tab and choose
**Report a vulnerability**. Do not open a public issue or pull request for a vulnerability.

Include what you found, how to reproduce it, and what an attacker gains. Useful examples are a way for a
non-owner to get instructions to the agent, a guest escaping the sandbox, a secret reaching Discord
unredacted, or an approval being skipped.

This is a small project maintained in spare time, so a reply may take a while, and there is no
service-level guarantee.

## Supported versions

Only the latest commit on the default branch is supported.

## What is in scope

The trust model is described in the README under "Security model and its limits". In short, owners are
trusted with a shell by design, so "an owner can run commands" is not a vulnerability. These are:

- anyone who is not an owner getting their words treated as instructions;
- a guest task reading files, running commands, or reaching tools it should not have;
- an approval, `send_message` confirmation or owner-only button working for someone it should not;
- secrets (the bot token, `.env` values) leaking into the agent's environment or into Discord posts.
