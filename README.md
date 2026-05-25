# Science Workshop

A static prototype for a journal workshop intelligence dashboard.

## What is included

- `index.html` - the interactive frontend prototype for journal tracking, data sources, RSS discovery, and adapter planning.
- `data/adapter-profiles.json` - the first adapter registry for Chinese journals and non-article RSS sources.
- `scripts/adapter-smoke-test.mjs` - a small validation script for the adapter registry.

## Current workflow

1. Track journal updates in a timeline-style interface.
2. Maintain journal source metadata such as homepage, archive URL, sample article URL, RSS status, and parser profile.
3. Separate sources into direct article RSS feeds and adapter queues.
4. Group adapter work by platform type, such as AJCass, Magtech-style journal CMS, CNKI/CBPT, university sites, custom association sites, and English publisher pages.

## Local check

```bash
node scripts/adapter-smoke-test.mjs
```

For a quick browser preview, open `index.html` directly or serve the directory with a local static server.
