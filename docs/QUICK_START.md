# Quick start for repo owner (do this once)

1. From repo root, unzip the team setup archive into this folder. It is additive and doesn't replace existing Next.js files.
2. Make sure `src/types/tellr.ts`, `CLAUDE.md`, `.github/workflows/ci.yml`, and `env.example` exist.
3. `cp env.example .env.local` and fill keys **only on your own computer**. Share needed key values via private password manager / appropriate secure channel, NOT via Google Docs, GitHub, Claude prompts, Slack public channels.
4. `git add CLAUDE.md env.example docs/ src/types/ src/features/ src/data/demo/ .github/`
5. `git commit -m "chore: add Tellr team contracts and workflow"`
6. `git push origin main` (initial scaffolding only; thereafter use feature branches and PRs).
7. Invite 3 collaborators; send them the repo URL and assign each a `feat/` branch.
8. Copy `docs/CLAUDE_TASK_PROMPTS.md` into the team Google Doc; keep `CLAUDE.md` in repo so Claude Code automatically reads it.

Do not run `git add .` from outside `~/tellr`. Never add `.env.local`.
