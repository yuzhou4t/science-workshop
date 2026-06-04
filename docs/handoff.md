# Handoff

## Snapshot

Status on 2026-06-04:

- Prototype path: `/Users/yuzhou4tc/Public/工作坊/journal-workshop-prototype`.
- Frontend entry: `index.html`.
- Source registry: `data/adapter-profiles.json`.
- Latest daily run ready sources: 21 of 22; `中国行政管理` timed out against CQVIP in that run.
- Direct article RSS/eTOC feeds: 5.
- Adapter-based sources: 17.
- Local daily scheduler: installed as `com.science-workshop.daily`.
- Codex app automation `science-workshop`: paused to avoid duplicate daily runs.

The frontend history currently merges through `data/recent-articles-2026-06-04_2026-06-04.json`:

- `history_articles`: 326.
- `new_push_queue_articles` from the 2026-06-04 daily run: 24.
- `data/recent-front-data.js` and `data/push-history.json` both contain 326 unique article IDs.
- Remaining discovery-only links: 17, currently all from `南开管理评论`.
- `data/source-state.json` is initialized and tracks 511 first-seen article IDs.

The daily dedupe state is initialized in `data/source-state.json`. Rebuilding frontend data now appends into `data/push-history.json`, so a one-day run does not overwrite the visible timeline with only that day.

## What Is Working

- Timeline UI reads `data/recent-front-data.js` and sorts push cards by first discovery date.
- Collapsible filters support language, subject, journal, and date range.
- A/A+ ratings are visually distinct in the frontend.
- Author enrichment is active for the current English and Chinese source set.
- Date display separates first-seen push timing from article publication date and issue date.
- `JOURNAL OF FINANCE` duplicate inputs are canonicalized into one journal identity.
- Chinese sources without RSS use automated adapters or fallback catalog sources instead of manual uploads.
- `管理科学学报` has both current issue-browser extraction and older reader issue-page fallback. The 2026-06-04 daily run returned READY with 11 current-issue articles.
- `中国行政管理` uses CQVIP only as a discovery catalog and resolves the current issue to NCPSD article detail pages before frontend display. Its 2026-06-04 timeout should be treated as network/protection first, not a parser regression.
- `管理世界` uses Macrodatas only for discovery, then queries the NCPSD mobile issue page and matches official titles to `Literature/articleinfo` single-article pages. `Literature/readurl` is kept only as auxiliary reader/download metadata because direct external clicks can redirect to login. The previous CNKI CJFD sequence resolver was removed because issue-order filenames can point to the wrong article; the 2026年第5期 live probe now resolves 11/11 records to official NCPSD single-article links.
- `南开管理评论` uses Macrodatas only for discovery, then tries an NCPSD official-detail resolver built from the discovered year/issue. As of 2026-06-04, 17 records correctly remain `needs_official_pdf`.
- A local macOS LaunchAgent runs the daily workflow at 10:00.

## Remaining Work

- Watch `logs/daily-workflow.log` after scheduled runs to confirm whether the `中国行政管理` CQVIP timeout recurs.
- Continue improving exact publication-date extraction for forthcoming or issue-only sources when their detail pages expose stronger metadata.
- Add a user-facing data-source intake flow for future Excel/CSV upload or single-source submission.
- Decide how online deployment should store state before publishing; `data/source-state.json` is currently local-file state.
- Add conversion workflows for turning selected journal articles into public-account drafts after the tracking workflow stabilizes.

## Useful Commands

Run the daily workflow manually:

```bash
node scripts/run-daily-workflow.mjs
```

Run a full trial without mutating dedupe state:

```bash
node scripts/fetch-articles-smoke-test.mjs --workflow --since=2026-04-27 --until=2026-05-27 --ignore-state
```

Rebuild frontend push data from cumulative history:

```bash
node scripts/build-front-data.mjs --workflow=data/recent-articles-2026-04-27_2026-05-27.json
```

Refresh the local scheduler:

```bash
node scripts/install-daily-launchd.mjs
```
