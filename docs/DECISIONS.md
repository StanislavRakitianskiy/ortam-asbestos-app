# Decisions

Short records of non-obvious choices. Newest at the bottom.

## D-001 · Next.js + SQLite + Gotenberg, no n8n (2026-10-18)

**Decision.** One Next.js (App Router) app holds the UI and the server logic as route handlers. Data lives in a
SQLite file through Prisma. DOCX → PDF conversion runs in Gotenberg 8 from `docker-compose.yml`.

**Why.**
- A reviewer starts everything with two commands: `docker compose up -d` and `npm run setup && npm run dev`.
  No database server, no message queue, no extra accounts.
- One TypeScript codebase means the domain rules (matching, categories A–D, costs in integer cents) are plain
  functions with unit tests, shared by the UI and the server.
- SQLite is a single gitignored file: enough for one employee on one machine, and trivial to reset.
- Gotenberg converts the generated DOCX with LibreOffice, so the preview PDF and the Word download come from the
  same document instead of two separate renderers.

**Why not n8n.** n8n would add a second runtime, its own database and credentials, and workflows stored outside
the repository, where tests and code review cannot reach them. Each step here (extract, validate, match, price,
render) is a function call that needs strict typing and tests, not a visual workflow.

## D-002 · Prisma 6.19.3, not 7.x (2026-10-18)

Prisma 7 requires a driver adapter for SQLite (`@prisma/adapter-better-sqlite3` plus the native `better-sqlite3`
build). CLAUDE.md asks for approval before adding dependencies, and a native build is one more thing that can fail
on a reviewer's machine. Prisma 6 needs neither. `npm audit` flags `deepmerge-ts` inside the Prisma 6 CLI config
loader (stack exhaustion on recursive objects): dev-time CLI only, never in the app runtime. Revisit if we upgrade.

Prisma does not read `.env.local`, so `prisma.config.ts` loads it with Node's `process.loadEnvFile`.
`DATABASE_URL="file:./dev.db"` resolves relative to `prisma/schema.prisma`, so the file is `prisma/dev.db`.

## D-003 · Vitest 4.1.12, Node ≥ 22.18 (2026-10-18)

Vitest 5 declares `node: ^22.12 || ^24 || >=26`, which excludes Node 25 (the development machine). Vitest 4
supports 20, 22 and ≥ 24. `engines.node` is `>=22.18.0` because the seed (`prisma/seed.mts`) runs on Node's
built-in TypeScript support. Recommended runtime: Node 24 LTS.

## D-004 · pdfjs-dist pinned to react-pdf's version (2026-10-18)

`react-pdf@11.0.0` depends on exactly `pdfjs-dist@6.3.289`. The top-level `pdfjs-dist` (server-side text
extraction) uses the same version, so there is one copy and the browser worker matches the viewer API.

## D-005 · Exact dependency versions (2026-10-18)

`.npmrc` sets `save-exact=true`; `package.json` has no `^` or `~`, and `package-lock.json` is committed.
`npm audit` also flags `braces` via `eslint-config-next` (lint tooling only).

## D-006 · Gotenberg bound to 127.0.0.1 (2026-10-18)

Gotenberg has no authentication and can render arbitrary HTML and URLs, so the compose file publishes it as
`127.0.0.1:3001:3000` rather than on every network interface. The app reaches it at `http://localhost:3001`.

## D-007 · "Anthropic key configured" is a format check (2026-10-18)

`/api/health` reports `configured: true` only when `ANTHROPIC_API_KEY` is set and shaped like `sk-ant-…`. It
does not call the API (no cost, works offline) and never returns the value. A placeholder or comment in
`.env.local` shows as "Not configured" with a hint.

## D-008 · `typecheck` runs `next typegen` first (2026-10-18)

Next.js 16 generates global route types such as `LayoutProps` into `.next/types`. On a fresh clone that folder
does not exist, so `npm run typecheck` is `next typegen && tsc --noEmit`.

## D-009 · Money rounding: each amount to the cent, integer arithmetic (2026-10-19)

Rates and allowances are integer cents. A zone quantity has at most two decimals (`materialZoneSchema`), so it is
converted to hundredths of a unit and multiplied by the rate in cents with exact integer arithmetic. The removal amount
and the replacement amount are each rounded half-up to whole cents, and `lineTotal = removal + replacement`. This way
the removal subtotal plus the replacement subtotal always equals the zone subtotal printed in the report. Contingency is
`round(direct × 20 / 100)`. `formatCad` formats from integer cents, never from a float.

## D-010 · Review issue severity (2026-10-19)

- **blocking**: an ID or data problem the employee must resolve or explicitly flag: unmatched lab sample, a sample ID in
  two zones, conflicting results, a registered sample with no lab result (often a typo such as `S7`), and an unknown or
  unit-mismatched rate on a zone that would be priced.
- **warning**: a legitimate limitation that the report carries as-is: inconclusive layer, unsampled or inaccessible
  zone, detected zone with unknown quantity or no rate reference, a bad rate on a zone that is not priced anyway, and
  the same lab report ID in two uploaded files (identical rows are already counted once).

Issue keys are `TYPE:id[:id…]` built from the zone ID, normalized sample ID, layer key or lab report ID, so they stay
stable when the match is recomputed and an employee's resolution can be stored against them.

A sample ID listed in two zones keeps its lab results under both zones until the employee fixes the register. Hiding
them would make the sample look "awaiting result", which is false; the blocking issue keeps the report from looking
final.

## D-011 · Layer comparison (2026-10-19)

Layers of one sample are compared after trimming, collapsing whitespace and lower-casing ("Black adhesive" equals
"black  adhesive"). Different wording stays two separate layers; nothing is merged by similarity. The same sample and
layer with different labels is a CONFLICT layer: it does not count as detected, and the zone is DETECTED only if
another layer is detected without conflict.
