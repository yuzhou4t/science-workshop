# Science Workshop

A static prototype for a journal workshop intelligence dashboard.

## What is included

- `index.html` - the interactive frontend prototype for journal tracking, data sources, RSS discovery, and adapter planning.
- `data/adapter-profiles.json` - the adapter registry for direct RSS feeds, Chinese journal platforms, non-article feed fallbacks, source URLs, and per-source rule hints.
- `data/fetch-smoke-results.json` - the latest live probe output, including article samples, blocked reasons, and whether a source can currently be used for article push.
- `scripts/adapter-smoke-test.mjs` - a small validation script for the adapter registry.
- `scripts/adapter-fallback-test.mjs` - assertions for the automated fallback rules that replaced blocked source pages.
- `scripts/fetch-articles-smoke-test.mjs` - a live extraction smoke test that applies platform-specific adapter rules and writes `data/fetch-smoke-results.json`.
- `scripts/recent-workflow-lib.mjs` - pure helpers for converting probe results into a recent-article workflow queue.
- `scripts/recent-workflow-test.mjs` - unit checks for date windows, month-level dates, undated candidates, and new-article detection.

## Current workflow

1. Track journal updates in a timeline-style interface.
2. Maintain journal source metadata such as homepage, archive URL, sample article URL, RSS status, and parser profile.
3. Separate sources into direct article RSS feeds and adapter queues.
4. Group adapter work by platform type, such as AJCass, Magtech-style journal CMS, CNKI/CBPT, university sites, custom association sites, and English publisher pages.
5. Use fallback sources when primary pages are blocked: Macrodatas issue discovery for blocked Chinese journal pages, CQVIP SSR catalog extraction for 中国行政管理, ASC current issue pages for 会计研究, and Crossref/OpenAlex for publisher pages that return 403.
6. Probe sources before production use: direct RSS feeds are parsed as XML; non-RSS pages are extracted through platform adapters.

## Local check

```bash
node scripts/adapter-fallback-test.mjs
node scripts/recent-workflow-test.mjs
node scripts/adapter-smoke-test.mjs
node scripts/fetch-articles-smoke-test.mjs
```

`adapter-fallback-test.mjs` verifies that the formerly blocked journals use automated fallback rules. `recent-workflow-test.mjs` validates the lightweight workflow queue rules. `adapter-smoke-test.mjs` validates the adapter registry shape. `fetch-articles-smoke-test.mjs` runs a live fetch against direct RSS feeds and adapter source pages, then writes `data/fetch-smoke-results.json`.

To run the lightweight workflow for a date window:

```bash
node scripts/fetch-articles-smoke-test.mjs --since=2026-04-25 --until=2026-05-25
```

This writes `data/recent-articles-2026-04-25_2026-05-25.json` and updates `data/source-state.json`. Add `--ignore-state` for a trial run where every article in the window is marked as newly discovered. Add `--baseline` when first deploying a source set so existing no-date articles are recorded but not pushed as new.

Latest smoke test result: 22 article-ready sources out of 22 total sources. This includes 5 direct RSS feeds and 17 adapter-based sources. No source is currently blocked in the live smoke test, though several Chinese journals now depend on fallback issue indexes rather than their protected primary pages.

Latest lightweight workflow trial for 2026-04-25 to 2026-05-25: 111 date-window articles from 22 ready sources, plus 182 no-date first-seen articles. The generated push queue contains 293 articles: 111 pushed by publication date and 182 pushed by first-seen detection so no-date sources do not get silently dropped.

For a quick browser preview, open `index.html` directly or serve the directory with a local static server.
