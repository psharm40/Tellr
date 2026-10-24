# Tellr — four-person teamwork guide

Fill in names and GitHub handles:
| Stream | Owner | Branch | Allowed files |
|---|---|---|---|
| 1. UI + accessibility | TBD | `feat/storefront` | `src/app/**` excluding api, `src/components/**`, `src/features/storefront/**` |
| 2. Cartesia voice | TBD | `feat/voice` | `src/features/voice/**`, `src/app/api/voice/**` |
| 3. Claude inspection | TBD | `feat/inspection` | `src/features/inspection/**`, `src/app/api/requirements/**`, `src/app/api/inspection/**` |
| 4. Checkout/session | TBD | `feat/checkout` | `src/features/checkout/**`, `src/app/api/checkout/**`, `src/lib/session/**` |

Shared files: `src/types/tellr.ts`, `docs/API_CONTRACTS.md`, `src/data/demo/**`, `package.json`, `package-lock.json`, `.env.example` (if renamed), `CLAUDE.md`.
**Do not independently change shared files** while multiple branches are active. Discuss any change, merge the shared-contract PR to main, and have everyone `git pull`/rebase.

## Setup for each teammate (AFTER owner pushes scaffold to main)
```
git clone <repo HTTPS URL>
cd tellr
npm ci
cp env.example .env.local
# add private keys supplied via password manager to .env.local
git switch -c feat/<your-stream>
npm run dev
```

## Working every day
- `git status` (confirm correct repo and branch).
- `git add <your files>`; `git commit -m "feat(inspection): analyze listing images"`; `git push -u origin feat/inspection`.
- Open GitHub **Pull requests** -> **New pull request** -> compare your branch to main.
- In a PR show changed files, how to test, screenshot/demo, and any API changes.
- Get a teammate to review where practical; merge only when build/checks are green.
- Before next work: `git switch main && git pull && git switch feat/<your-stream> && git merge main`.
- Avoid force-pushing others' branches. Avoid everyone editing `src/app/page.tsx` or `package.json` simultaneously.
- To inspect a teammate's changes, use GitHub **Pull requests -> Files changed**, or inspect their branch locally without editing it.
- If editing from a second terminal, verify the current branch first. One shared local working tree cannot be on two branches simultaneously; use separate clones or `git worktree` if needed.

## GitHub setup (repo owner)
1. Settings -> Collaborators -> add all 3 teammates with write access.
2. Settings -> Branches/Rules -> protect `main` and require PR review/checks IF your GitHub plan permits; otherwise enforce as team policy.
3. GitHub -> Actions -> ensure the checks from `.github/workflows/ci.yml` run on PRs.
4. Optional: Vercel -> Import `tellr` repo; deploy `main` as production. Configure required env vars separately in Vercel.
5. Work via PRs; don't use `main` as a personal coding branch.

## Ownership conflicts
Frontend owns display components; voice provides reusable `VoiceAssistant` component under `src/features/voice` and exposes a simple prop API. Frontend imports it.
Inspection owns callable inspection services; frontend consumes their typed data.
Checkout owns rule engine and API; frontend supplies `CheckoutSnapshot` according to shared types.
