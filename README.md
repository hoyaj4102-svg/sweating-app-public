# SWEATING (public code snapshot)

This repository is a public, code-only snapshot of SWEATING, a workout-class dating app.

It is meant for reading the product code and running it locally. It is not the private working repository, and it does not include internal notes, decision logs, security checklists, or live service settings.

## What you can run locally

- Node.js 22 and pnpm (`packageManager` in `package.json`)
- `pnpm install`
- Copy the placeholder `.env.example` files in `artifacts/api-server` and `artifacts/swetin-workout-dating` to `.env` and fill in your own local values
- `pnpm --filter @workspace/api-server run dev` — API on port 8787
- `pnpm --filter @workspace/swetin-workout-dating run dev` — site on port 5173
- `pnpm run typecheck`
- `pnpm test`
- `pnpm run build`

You need your own database and auth project to use the app end to end. This snapshot does not include production credentials or a hosted project.

## Layout

- `artifacts/swetin-workout-dating` — web app
- `artifacts/api-server` — API and SQL migrations
- `lib` — shared libraries
- `scripts` — local helper scripts
- `.github/workflows` — CI for typecheck, tests, and SQL checks

Demo class names and addresses in this snapshot are fictional examples.
