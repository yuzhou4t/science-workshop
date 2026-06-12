# Handoff

## Snapshot

Status on 2026-06-06:

- Prototype path: `/Users/yuzhou4tc/Public/工作坊/journal-workshop-prototype`.
- Frontend entry: `index.html`.
- Source registry: `data/adapter-profiles.json`.
- Latest cumulative frontend history: 379 unique article IDs.
- Articles with abstracts: 309 of 379.
- Direct article RSS/eTOC feeds: 5.
- Adapter-based sources: 17.
- Local daily scheduler: installed as `com.science-workshop.daily`.
- Codex app automation `science-workshop`: paused to avoid duplicate daily runs.

The frontend history currently lives in:

- `data/push-history.json`.
- `data/recent-front-data.js`.

The remaining abstract gaps are:

- `中国工业经济`: 18, all from 2026-04 and 2026-05; NCPSD has not listed those issues yet.
- `会计研究`: 13, all from 2026-04; NCPSD has not listed that issue yet.
- English journals: 38, mostly protected publisher pages, replies, editorials, or book reviews where Crossref/OpenAlex/Semantic Scholar do not expose an abstract.
- `中国农村经济`: 1, a meeting-review article whose OCR text has no `摘要` / `关键词` block.

The daily dedupe state is initialized in `data/source-state.json`. Rebuilding frontend data now appends into `data/push-history.json`, so a one-day run does not overwrite the visible timeline with only that day.

## What Is Working

- Timeline UI reads `data/recent-front-data.js` and sorts push cards by first discovery date.
- Collapsible filters support language, subject, journal, and date range.
- A/A+ ratings are visually distinct in the frontend.
- Author enrichment is active for the current English and Chinese source set.
- Article abstract display is active in the realtime tracking timeline.
- Daily abstract backfill is attached to `scripts/run-daily-workflow.mjs`. After new push articles are merged, it runs `scripts/backfill-daily-abstracts.mjs --first-seen-at=<date>` and merges successful abstract-only workflow files.
- Date display separates first-seen push timing from article publication date and issue date.
- `JOURNAL OF FINANCE` duplicate inputs are canonicalized into one journal identity.
- Chinese sources without RSS use automated adapters or fallback catalog sources instead of manual uploads.
- `管理科学学报` has both current issue-browser extraction and older reader issue-page fallback. The 2026-06-04 daily run returned READY with 11 current-issue articles.
- `中国行政管理` uses CQVIP only as a discovery catalog and resolves the current issue to NCPSD article detail pages before frontend display. Its 2026-06-04 timeout should be treated as network/protection first, not a parser regression.
- `中国行政管理` abstract backfill uses a slow NCPSD article API queue and successfully filled the 2026-06-06 backlog.
- `中国工业经济` and `会计研究` official detail pages can be blocked by access verification or login. Their abstract backfill uses NCPSD mobile issue pages when those issues are listed.
- `中国农村经济` official PDFs can be scanned. `scripts/backfill-pdf-abstracts.mjs` tries PDF text first and uses `tesseract` + `poppler` OCR only as a fallback.
- English journal abstract backfill uses Crossref/OpenAlex, with Semantic Scholar available as an optional DOI lookup; protected publisher pages should not be bypassed.
- `管理世界` uses Macrodatas only for discovery, then queries the NCPSD mobile issue page and matches official titles to `Literature/articleinfo` single-article pages. `Literature/readurl` is kept only as auxiliary reader/download metadata because direct external clicks can redirect to login. The previous CNKI CJFD sequence resolver was removed because issue-order filenames can point to the wrong article; the 2026年第5期 live probe now resolves 11/11 records to official NCPSD single-article links.
- `南开管理评论` uses Macrodatas only for discovery, then tries an NCPSD official-detail resolver built from the discovered year/issue. As of 2026-06-04, 17 records correctly remain `needs_official_pdf`.
- A local macOS LaunchAgent runs the daily publish workflow at 10:00. It runs the daily article workflow, commits generated data files, and pushes `origin/main` for Vercel deployment.

## Remaining Work

- Watch `logs/daily-workflow.log` after scheduled runs to confirm whether the `中国行政管理` CQVIP timeout recurs.
- Watch daily abstract backfill logs after scheduled runs. Successful backfill files should increase abstract coverage without changing `data/source-state.json`.
- Retry `中国工业经济` 2026-04/2026-05 and `会计研究` 2026-04 through NCPSD after those issues appear on NCPSD.
- Continue improving exact publication-date extraction for forthcoming or issue-only sources when their detail pages expose stronger metadata.
- Add a user-facing data-source intake flow for future Excel/CSV upload or single-source submission.
- Watch the automated GitHub push after scheduled runs; if authentication expires, rerun the publish command manually after refreshing local git credentials.
- Add conversion workflows for turning selected journal articles into public-account drafts after the tracking workflow stabilizes.

## Workflow Backend Additions

- Local FastAPI backend lives in `backend/`.
- Mock mode is controlled by `WORKFLOW_USE_MOCKS=true`.
- Workflow job artifacts are stored under `backend/storage/workflow_jobs/` by default and are ignored by git.
- Paper reading supports PDF upload, MinerU/DeepSeek adapters, full evidence-chain artifacts, final Markdown, and DOCX export.
- WeChat writing supports source text, tracked article id, paper-reading job id, final Markdown, and DOCX export.
- Job artifacts are retained for `WORKFLOW_RETENTION_DAYS`, defaulting to 7 days.

## Useful Commands

Run the daily workflow manually:

```bash
node scripts/run-daily-workflow.mjs
```

Run abstract backfill for one first-seen date:

```bash
node scripts/backfill-daily-abstracts.mjs --first-seen-at=2026-06-06
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
