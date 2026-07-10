# AGENTS.md

Project-specific instructions for agents working in Science Workshop.

- Treat this as a static prototype plus local Node.js crawler workflow. There is no package manager setup required for current scripts.
- Do not push to GitHub unless the user explicitly asks. Local git commits are fine for checkpoints.
- Protected FastAPI routes must fail closed unless `SCIENCE_WORKSHOP_PROXY_SECRET` and a non-empty trusted user identity are verified; `WORKFLOW_ALLOW_INSECURE_DIRECT_ACCESS=true` is only for isolated local tests.
- Workflow jobs, artifacts, edits, exports, reruns, events, and referenced evidence are owner-scoped; only the same owner or an admin may access them.
- Use `vercel dev` plus the local FastAPI service for production-like auth/RBAC checks. Opening `index.html` directly is a static preview only.
- Preserve `data/source-state.json` semantics: it is the dedupe and first-seen state for daily runs.
- Use `scripts/run-daily-workflow.mjs` as the daily entrypoint. It should initialize a baseline once and only update frontend data when new push articles exist.
- Keep daily abstract enrichment attached to the daily flow: newly pushed articles should be merged first, then `scripts/backfill-daily-abstracts.mjs --first-seen-at=<date>` should backfill only that first-seen date.
- Keep frontend article data cumulative: `scripts/build-front-data.mjs` should merge new workflow output into `data/push-history.json`, then regenerate `data/recent-front-data.js`.
- Keep `j1 -> j14` canonicalization for `JOURNAL OF FINANCE`; otherwise AFA forthcoming and Wiley RSS entries duplicate the same journal.
- For source failures, classify network/protection/parser/data-quality before changing rules. Prefer automated fallback sources over manual upload.
- Do not drop articles solely because publication date is missing. First-seen push handling is intentional.
- Frontend timeline push date is `first_seen_at`; publication date and issue date are metadata.
- After editing crawler or workflow logic, run the relevant pure checks in `docs/runbook.md`.
- After changing workflow output intended for the page, rebuild `data/recent-front-data.js` with `scripts/build-front-data.mjs` and verify `data/push-history.json` is still deduped.
- Keep human-facing handoff and operations details in `docs/`; keep this file limited to rules agents need before touching code.

Docs to read first:

- `docs/architecture.md` for data flow and date model.
- `docs/runbook.md` for commands, scheduler, and troubleshooting.
- `docs/handoff.md` for the current project snapshot.
