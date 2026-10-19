# Submission

What is sent for the ORTAM developer exercise, against "What to submit" on page 7 of
`fixtures/START_HERE_candidate_brief.pdf`.

## Deliverables

| Brief item | File or link | State |
|---|---|---|
| Source code (repository link or ZIP) | https://github.com/StanislavRakitianskiy/ortam-asbestos-app | Ready once the phase 9 files below are committed and pushed |
| Setup instructions with prerequisites | [README.md](../README.md) | Done; followed step by step on a fresh clone (see "Checks before sending") |
| Short demo recording or screenshots of the workflow and preview | — | TODO: not made yet |
| One generated Word report | [submission/ORTAM-DEMO-001_rev1.docx](../submission/ORTAM-DEMO-001_rev1.docx) | Done |
| Its matching PDF | [submission/ORTAM-DEMO-001_rev1.pdf](../submission/ORTAM-DEMO-001_rev1.pdf) | Done |
| Short handover note (time, AI tools, own checks, incomplete features, limitations) | [HANDOVER.md](../HANDOVER.md) | Written; "Actual time spent" and "What I checked myself" are still TODO |
| Environment variable example without real secrets | [.env.example](../.env.example) | Done |

## The report files

Both files are revision 1 of project `ORTAM-DEMO-001` (M03 = 140 m2, LAB-A/B/C accepted, narrative drafted by
`claude-sonnet-5-5`), downloaded from the app's own download routes. They are byte-identical to the stored revision in
`storage/reports/…/rev-1/`.

| | Word | PDF |
|---|---|---|
| File | `ORTAM-DEMO-001_rev1.docx` | `ORTAM-DEMO-001_rev1.pdf` (19 pages) |
| Revision · snapshot | 1 · `5230918aa1e2` | 1 · `5230918aa1e2` |
| Generated | 2026-10-19 17:04 UTC | 2026-10-19 17:04 UTC |
| Total before tax | CAD 32,808.00 | CAD 32,808.00 |
| SHA-256 | `9866a54862a394c94ede7927cf7f32f4f88093edd35dbe80a7e368a623e84528` | `92eba55bcdeeedc96851ffe020db570b744baeda4fe666bee54bf087b0a4642a` |

`npm run verify` passes for this revision: every zone, category, amount and total matches the golden table in
`CLAUDE.md`, and both files print the same revision, snapshot and total. Generating again without a data change returns
this same revision (`created: false`).

In this revision the report date and "Prepared by" are empty ("not entered"), "Reviewed by" is "pending", and the
in-app Final review checklist is not ticked. Filling them in changes the report, so it would need a new revision
(rev 2) and a new copy into `submission/`.

## Supporting documents

- [docs/ACCEPTANCE.md](ACCEPTANCE.md): the brief's core checklist and case details, item by item.
- [docs/DECISIONS.md](DECISIONS.md): records D-001 to D-045.
- [docs/DATA_MODEL.md](DATA_MODEL.md): the SQLite tables.
- [CLAUDE.md](../CLAUDE.md): domain rules and golden expectations.
- [fixtures/test/LAB-X_edge_cases.pdf](../fixtures/test/LAB-X_edge_cases.pdf): the candidate-made edge-case fixture,
  described in HANDOVER.md.

## Not included

`.env.local` (the API key), `storage/` (uploads and revisions), `prisma/dev.db` and `.next/` are gitignored and have
never been committed.

## Checks before sending (2026-10-19)

- **Secrets.** `git grep -i "sk-ant"` over every commit finds only code (the key format check and redaction regex),
  documentation and three fake test keys. The real key from `.env.local` occurs in no commit, no commit diff and no
  tracked or untracked file, nor in `prisma/dev.db`, `storage/` or the report files. No other credential pattern (AWS,
  GitHub, Slack, private keys, `password=`/`token=` values) was found. The first commit (`93308a7 test`) contains a file
  `env.local` with a 6-character placeholder value, not a key; it was deleted in `e6cfe4a`.
- **Ignored files.** `.env.local`, `storage/` and `prisma/dev.db*` are matched by `.gitignore` and appear in no commit;
  only `.env.example` is tracked.
- **Clean clone.** The repository was cloned into a temporary folder (HEAD plus the uncommitted phase 9 changes) and
  the README was followed: `cp .env.example .env.local` with a key → `docker compose up -d` → `npm run setup` →
  `npm run db:seed` → `npm run dev -- --port 3005` (port 3000 was in use). Home page all green; LAB-A/B/C extracted by
  the real API (8 rows, every quote found); re-upload answered `duplicate`; Accept all verified; Matching equal to the
  golden table; AI narrative drafted with no guardrail warning; revision 1 generated and previewed; both downloads 200;
  `npm run verify` PASS. Edge project: LAB-X gives "S7" unmatched with the hint S07 and the S04 conflict, and blocks
  generation. `npm test` (419 passed, 1 skipped), `npm run typecheck`, `npm run lint` and `GOTENBERG_IT=1` conversion
  test all passed in the clone. Gotenberg was the already-running container of the same compose project, so the image
  download was not re-tested.
- **Fixed on the way.** With port 3000 taken, `next dev` moved to 3001 next to Gotenberg and the app's requests to
  `localhost:3001` reached Next.js instead of Gotenberg. `npm run dev` now fixes the port (D-045).

## Still to do before sending

- [ ] Fill in "Actual time spent" and "What I checked myself" in HANDOVER.md.
- [ ] Record the demo or take screenshots (workflow and preview) and add them here.
- [ ] Open `submission/ORTAM-DEMO-001_rev1.docx` in Microsoft Word once.
- [ ] Commit and push: `README.md`, `HANDOVER.md`, `docs/SUBMISSION.md`, `docs/ACCEPTANCE.md`, `docs/DECISIONS.md`,
      `package.json`, `submission/`.
- [ ] Check that the reviewers can open the repository link (or send a ZIP).
