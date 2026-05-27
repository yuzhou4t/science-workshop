# Handoff

## Snapshot

Status on 2026-05-27:

- Prototype path: `/Users/yuzhou4tc/Public/工作坊/journal-workshop-prototype`.
- Frontend entry: `index.html`.
- Source registry: `data/adapter-profiles.json`.
- Ready sources: 22 of 22.
- Direct article RSS/eTOC feeds: 5.
- Adapter-based sources: 17.
- Local daily scheduler: installed as `com.science-workshop.daily`.
- Codex app automation `science-workshop`: paused to avoid duplicate daily runs.

The reference full workflow output is `data/recent-articles-2026-04-27_2026-05-27.json`:

- `recent_articles`: 157.
- `push_queue_articles`: 191.
- `issue_dated_articles`: 24.
- `undated_candidates`: 34.

The daily baseline is initialized in `data/source-state.json`. The 2026-05-27 daily run found 9 articles in the day window and 0 new push articles, so the frontend data was not overwritten by an empty queue.

## What Is Working

- Timeline UI reads `data/recent-front-data.js` and sorts push cards by first discovery date.
- Collapsible filters support language, subject, journal, and date range.
- A/A+ ratings are visually distinct in the frontend.
- Author enrichment is active for the current English and Chinese source set.
- Date display separates first-seen push timing from article publication date and issue date.
- `JOURNAL OF FINANCE` duplicate inputs are canonicalized into one journal identity.
- Chinese sources without RSS use automated adapters or fallback catalog sources instead of manual uploads.
- A local macOS LaunchAgent runs the daily workflow at 10:00.

## Remaining Work

- Watch `logs/daily-workflow.log` after several scheduled runs to confirm the local network behaves consistently.
- Continue improving exact publication-date extraction for forthcoming or issue-only sources when their detail pages expose stronger metadata.
- Add a user-facing data-source intake flow for future Excel/CSV upload or single-source submission.
- Decide how online deployment should store state before publishing; `data/source-state.json` is currently local-file state.
- Add conversion workflows for turning selected journal articles into public-account drafts after the tracking workflow stabilizes.

## Useful Commands

Run the daily workflow manually:

```bash
node scripts/run-daily-workflow.mjs
```

Run a full 30-day trial without mutating dedupe state:

```bash
node scripts/fetch-articles-smoke-test.mjs --workflow --since=2026-04-27 --until=2026-05-27 --ignore-state
```

Rebuild frontend push data:

```bash
node scripts/build-front-data.mjs --workflow=data/recent-articles-2026-04-27_2026-05-27.json
```

Refresh the local scheduler:

```bash
node scripts/install-daily-launchd.mjs
```
