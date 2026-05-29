# Handoff

## Snapshot

Status on 2026-05-29:

- Prototype path: `/Users/yuzhou4tc/Public/工作坊/journal-workshop-prototype`.
- Frontend entry: `index.html`.
- Source registry: `data/adapter-profiles.json`.
- Latest live probe ready sources: 22 of 22.
- Direct article RSS/eTOC feeds: 5.
- Adapter-based sources: 17.
- Local daily scheduler: installed as `com.science-workshop.daily`.
- Codex app automation `science-workshop`: paused to avoid duplicate daily runs.

The frontend history currently merges through `data/recent-articles-2026-05-29_2026-05-29.json`:

- `history_articles`: 244.
- `new_push_queue_articles` from the 2026-05-29 daily run: 33.
- `data/recent-front-data.js` and `data/push-history.json` both contain 244 unique article IDs.
- Remaining discovery-only links: 28, currently `南开管理评论` 17 and `管理世界` 11.

The daily dedupe state is initialized in `data/source-state.json`. Rebuilding frontend data now appends into `data/push-history.json`, so a one-day run does not overwrite the visible timeline with only that day.

## What Is Working

- Timeline UI reads `data/recent-front-data.js` and sorts push cards by first discovery date.
- Collapsible filters support language, subject, journal, and date range.
- A/A+ ratings are visually distinct in the frontend.
- Author enrichment is active for the current English and Chinese source set.
- Date display separates first-seen push timing from article publication date and issue date.
- `JOURNAL OF FINANCE` duplicate inputs are canonicalized into one journal identity.
- Chinese sources without RSS use automated adapters or fallback catalog sources instead of manual uploads.
- `管理科学学报` has both current issue-browser extraction and older reader issue-page fallback. The latest local live probe returned READY, and the single-source probe returned 10 current-issue articles.
- `中国行政管理` uses CQVIP only as a discovery catalog and resolves the current issue to NCPSD article detail pages before frontend display.
- `管理世界` and `南开管理评论` use Macrodatas only for discovery, then try an NCPSD official-detail resolver built from the discovered year/issue. On 2026-05-29 both single-source live probes returned articles, but NCPSD returned no candidates for the target issues, so their records correctly remain `needs_official_pdf`.
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
