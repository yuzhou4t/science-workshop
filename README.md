# Science Workshop

Static prototype and local crawler workflow for a journal workshop intelligence dashboard.

## Quick Start

Open the prototype directly:

```bash
open index.html
```

Run the non-network validation checks:

```bash
node scripts/adapter-fallback-test.mjs
node scripts/recent-workflow-test.mjs
node scripts/html-adapter-parsers-test.mjs
node scripts/date-enhancement-test.mjs
node scripts/launchd-plist-test.mjs
node scripts/adapter-smoke-test.mjs
```

Run a live probe and rebuild the frontend data from a selected workflow file:

```bash
node scripts/fetch-articles-smoke-test.mjs --workflow --since=2026-04-27 --until=2026-05-27 --ignore-state
node scripts/build-front-data.mjs --workflow=data/recent-articles-2026-04-27_2026-05-27.json
```

## Project Map

- `index.html` - interactive frontend prototype for push timeline, source inventory, filters, and reserved conversion workflows.
- `data/adapter-profiles.json` - registry of 5 direct article feeds and 17 adapter-based sources.
- `data/fetch-smoke-results.json` - live source probe output.
- `data/recent-articles-*.json` - workflow outputs for recent windows or daily runs.
- `data/recent-front-data.js` - compact push queue consumed by `index.html`.
- `data/source-state.json` - dedupe and first-seen state for daily operation.
- `scripts/fetch-articles-smoke-test.mjs` - live source extraction and workflow generation.
- `scripts/build-front-data.mjs` - converts a workflow JSON file into frontend data.
- `scripts/run-daily-workflow.mjs` - daily one-day check used by the local scheduler.
- `scripts/install-daily-launchd.mjs` - installs or refreshes the macOS LaunchAgent.

## Documentation

- [Architecture](docs/architecture.md) - data flow, source model, date model, and frontend behavior.
- [Runbook](docs/runbook.md) - daily operations, scheduler commands, checks, and troubleshooting.
- [Handoff](docs/handoff.md) - 2026-05-27 project snapshot and remaining work.

## Operational Snapshot

As of 2026-05-27, the reference full live workflow file is `data/recent-articles-2026-04-27_2026-05-27.json`.

- Sources: 22 total, 22 ready.
- Recent articles in window: 157.
- Push queue articles: 191.
- Issue-date-only articles: 24.
- Undated candidates protected by first-seen detection: 34.
- Daily baseline: initialized in `data/source-state.json`.

The local macOS LaunchAgent `com.science-workshop.daily` is installed at:

```text
/Users/yuzhou4tc/Library/LaunchAgents/com.science-workshop.daily.plist
```

It runs `node scripts/run-daily-workflow.mjs` every day at 10:00 local time. Logs are written to `logs/daily-workflow.log` and `logs/daily-workflow.error.log`.
