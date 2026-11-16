# Contributing

Thanks for looking. Small, focused changes are easiest to review.

## Setup

```sh
npm ci
npm run check   # tsc --noEmit
npm test        # offline tests: redaction, routing, schedules, and the 200-line rule
```

Node 22.18 or newer. The code runs as plain TypeScript through Node's type stripping, with no build step, so:

- imports keep the `.ts` extension;
- no constructor parameter properties, enums or namespaces (the compiler runs with `erasableSyntaxOnly`).

## Style

- Every source file stays at or under **200 lines** (`npm run lines`, also part of `npm test`). Split a file rather
  than raising the limit.
- Small files with one job each, and comments that explain why, not what.
- Keep the security properties described in the README. A change that lets someone other than an owner
  instruct the agent, or lets a guest reach a shell or files, needs a very good reason and a test.

## Pull requests

- Say what changed and why, and how you checked it. `npm run check` and `npm test` must pass.
- Do not commit `.env`, `data/`, tokens, Discord ids of real people, or personal paths.
- Report vulnerabilities privately, as described in [SECURITY.md](SECURITY.md).
- There are no GitHub Actions workflows in this repository on purpose: run the checks locally.
