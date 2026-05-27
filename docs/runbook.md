# Runbook

This runbook covers local operation for the Science Workshop prototype and crawler.

## Open The Prototype

```bash
open index.html
```

If a browser blocks local script loading in a future version, serve the directory instead:

```bash
python3 -m http.server 8000
```

Then open `http://127.0.0.1:8000`.

## Local Checks

Run the pure checks before committing script or frontend-data changes:

```bash
node scripts/adapter-fallback-test.mjs
node scripts/recent-workflow-test.mjs
node scripts/html-adapter-parsers-test.mjs
node scripts/date-enhancement-test.mjs
node scripts/launchd-plist-test.mjs
node scripts/adapter-smoke-test.mjs
node --check scripts/fetch-articles-smoke-test.mjs
node --check scripts/run-daily-workflow.mjs
node --check scripts/install-daily-launchd.mjs
```

Run the live probe when network behavior matters:

```bash
node scripts/fetch-articles-smoke-test.mjs --workflow --since=2026-04-27 --until=2026-05-27 --ignore-state
```

Rebuild frontend data from a workflow file:

```bash
node scripts/build-front-data.mjs --workflow=data/recent-articles-2026-04-27_2026-05-27.json
```

## Daily Scheduler

Install or refresh the local macOS LaunchAgent:

```bash
node scripts/install-daily-launchd.mjs
```

The installed job:

- Label: `com.science-workshop.daily`
- Plist: `/Users/yuzhou4tc/Library/LaunchAgents/com.science-workshop.daily.plist`
- Schedule: daily at 10:00 local time
- Command: `node scripts/run-daily-workflow.mjs`
- Working directory: `/Users/yuzhou4tc/Public/工作坊/journal-workshop-prototype`

Check scheduler state:

```bash
launchctl print gui/$(id -u)/com.science-workshop.daily
```

Validate the plist:

```bash
plutil -lint /Users/yuzhou4tc/Library/LaunchAgents/com.science-workshop.daily.plist
```

## Logs

Daily workflow logs:

- `logs/daily-workflow.log`
- `logs/daily-workflow.error.log`

The daily script writes a one-day workflow file such as `data/recent-articles-2026-05-27_2026-05-27.json`. If no new push articles are found, `data/recent-front-data.js` is left unchanged.

## Source Troubleshooting

Classify failures before changing adapters:

- Network or DNS failure: local environment problem; retry from the same Mac before editing rules.
- HTTP protection such as 403, 412, CAPTCHA, or WAF: prefer an official feed, public API, Crossref/OpenAlex, or a stable catalog fallback.
- Parser failure: fetch succeeds but titles, dates, authors, or URLs are wrong; patch the adapter and add or update a focused test.
- No explicit article date: keep the article in first-seen flow instead of dropping it.

Do not mark a source ready unless the live probe returns usable article samples or a documented automated fallback.

## Git Policy

Use local git commits for checkpoints. Do not push to GitHub unless the user explicitly asks for it.
