# gemini-proxy

Multi-key Gemini API reverse proxy deployed on Vercel as a single Edge Function (`api/index.ts`). It spreads requests across several Gemini API keys (chosen at random per request) so you can pool free-tier quotas.

## Setup

```bash
bun install
```

Requires `GEMINI_API_KEY` (comma-separated Gemini keys, randomly rotated per request). Missing → 500 JSON error.

Optional `PROXY_API_KEY`: when set, clients must send it as `x-proxy-api-key`, `x-api-key`, or `Authorization: Bearer <key>`.

## Run locally

```bash
bunx vercel dev
```

## Usage

- `GET /health` or `/api/health` → `{ "status": "ok", "activeKeys": N }`
- All other paths proxy to `generativelanguage.googleapis.com`:
  - strips `/api` prefix, injects `/v1beta` before `/models/` paths
  - handles rate limits (429) by automatically retrying with remaining available keys

## Checks

```bash
bun check        # typecheck
bun run lint     # oxlint
bun run format   # oxfmt (writes in place)
```

## Deploy

```bash
bun run vercel:deploy
```

Requires Vercel CLI auth; the project is linked in `.vercel/project.json`.
