# gemini-proxy

Multi-key Gemini API reverse proxy deployed on Vercel as a single Edge Function. Its core job is spreading requests across several `GEMINI_API_KEY`s, chosen at random per request (no shared counter, since Edge instances are not shared).
Entrypoint: `api/index.ts` — named exports `GET`/`POST`/`PUT`/`DELETE` (no default export), `config.runtime = "edge"`.
There is no `vercel.json`; Vercel auto-detects `api/index.ts` as the `/api` function. No tests.

## Commands

- `bun install` — install deps (lockfile: `bun.lock`)
- `bun check` (alias `bun run typecheck`) — typecheck. tsconfig: strict, `noEmit`, `moduleResolution: bundler`, `types: ["bun"]`, `moduleDetection: force`, `allowImportingTsExtensions: true`, `noUncheckedIndexedAccess: true`.
- `bun run lint` — `oxlint` (no `.oxlintrc`; default rules)
- `bun run format` — `oxfmt`, writes in place. It also formats Markdown/JSON, so it will rewrite `AGENTS.md` and `package.json`; use `bunx oxfmt --check` to check only.
- `bunx vercel dev` — local run (no `dev` script; `server.ts` was deleted).
- `bun run vercel:deploy` — `vercel --prod`. Requires Vercel CLI auth; project is linked in `.vercel/project.json`.

## Environment

- `GEMINI_API_KEY` (required): comma-separated Gemini keys, a random one is picked per proxied request. Missing → 500 JSON error.
- `PROXY_API_KEY` (optional): if set, clients must send `x-proxy-api-key`, `x-api-key`, or `Authorization: Bearer <key>`; header stripped before forwarding.

## Behavior

- `GET /health` or `/api/health` → `{ status: "ok", activeKeys: N }`
- All other paths proxy to `generativelanguage.googleapis.com`:
  - strips `/api` prefix, injects `/v1beta` before `/models/` paths
  - strips `host`, `x-proxy-api-key`, `x-api-key`, `authorization` headers upstream
  - sets the `key` query param (or `x-goog-api-key` header) to a randomly chosen key
  - non-JSON/error responses stream through
- A 429 from Gemini is retried with the remaining keys (each key at most once per request); if all keys are rate limited, the last 429 goes to the client.

## Deploy

- Vercel Edge Function. `.vercel/` holds the linked project ids and is currently committed despite `.vercel/README.txt` saying not to share it — do not add more secrets there.

## Pre-commit

- husky + lint-staged runs `bun run typecheck`, `bun run lint`, `bun run format` on staged `*.{ts,tsx,js,mjs,cjs}` before each commit.

## Commits

- Conventional commits: `feat`, `fix`, `refactor`, `doc`, `chore`, etc. (e.g. `doc: add AGENTS.md`).

## Tests

- `bun test` — runs `api/index.test.ts` (12 unit tests, all offline; `fetch` is mocked).
- `bun test --coverage` — runs with coverage; `api/index.ts` is at 100% lines/functions.
