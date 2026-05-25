# Science Workshop

A static prototype for a journal workshop intelligence dashboard.

## What is included

- `index.html` - the interactive frontend prototype for journal tracking, data sources, RSS discovery, and adapter planning.
- `data/adapter-profiles.json` - the adapter registry for direct RSS feeds, Chinese journal platforms, non-article feed fallbacks, source URLs, and per-source rule hints.
- `data/fetch-smoke-results.json` - the latest live probe output, including article samples, blocked reasons, and whether a source can currently be used for article push.
- `scripts/adapter-smoke-test.mjs` - a small validation script for the adapter registry.
- `scripts/fetch-articles-smoke-test.mjs` - a live extraction smoke test that applies platform-specific adapter rules and writes `data/fetch-smoke-results.json`.

## Current workflow

1. Track journal updates in a timeline-style interface.
2. Maintain journal source metadata such as homepage, archive URL, sample article URL, RSS status, and parser profile.
3. Separate sources into direct article RSS feeds and adapter queues.
4. Group adapter work by platform type, such as AJCass, Magtech-style journal CMS, CNKI/CBPT, university sites, custom association sites, and English publisher pages.
5. Probe sources before production use: direct RSS feeds are parsed as XML; non-RSS pages are extracted through platform adapters.

## Local check

```bash
node scripts/adapter-smoke-test.mjs
node scripts/fetch-articles-smoke-test.mjs
```

`adapter-smoke-test.mjs` validates the adapter registry shape. `fetch-articles-smoke-test.mjs` runs a live fetch against direct RSS feeds and adapter source pages, then writes `data/fetch-smoke-results.json`.

Latest smoke test result: 15 article-ready sources out of 22 total sources. This includes 5 direct RSS feeds and 10 adapter-based sources. Current blocked cases are captcha/page protection, expired certificates or server errors, and publisher pages returning 403.

For a quick browser preview, open `index.html` directly or serve the directory with a local static server.
