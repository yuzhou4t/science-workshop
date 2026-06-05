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
node scripts/fetch-retry-policy-test.mjs
node scripts/article-link-policy-test.mjs
node scripts/ajcass-link-policy-test.mjs
node scripts/official-link-resolvers-test.mjs
node scripts/macrodatas-url-test.mjs
node scripts/recent-workflow-test.mjs
node scripts/front-data-history-test.mjs
node scripts/html-adapter-parsers-test.mjs
node scripts/date-enhancement-test.mjs
node scripts/launchd-plist-test.mjs
node scripts/build-adapter-front-data-test.mjs
node scripts/adapter-smoke-test.mjs
node --check scripts/fetch-articles-smoke-test.mjs
node --check scripts/build-front-data.mjs
node --check scripts/build-adapter-front-data.mjs
node --check scripts/run-daily-workflow.mjs
node --check scripts/install-daily-launchd.mjs
```

## Local Workflow Backend

Install and run the local FastAPI workflow backend:

```bash
cd backend
python3.11 -m venv .venv
. .venv/bin/activate
python -m pip install -r requirements.txt
cp .env.example .env
uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

For mock-mode smoke tests, set `WORKFLOW_USE_MOCKS=true` in `backend/.env`. Real MinerU and DeepSeek runs require:

```text
DEEPSEEK_API_KEY
MINERU_API_KEY
TENCENT_COS_SECRET_ID
TENCENT_COS_SECRET_KEY
TENCENT_COS_REGION
TENCENT_COS_BUCKET
```

Run backend tests:

```bash
cd backend
. .venv/bin/activate
python -m pytest -v
```

Create a mock paper-reading job:

```bash
curl -s -X POST http://127.0.0.1:8000/api/workflows/paper-reading/jobs \
  -F "template_id=africa-reading" \
  -F "file=@/path/to/paper.pdf"
```

Create a mock WeChat writing job:

```bash
curl -s -X POST http://127.0.0.1:8000/api/workflows/wechat-writing/jobs \
  -F "source_text=这是一段补充材料" \
  -F "template_id=africa-reading"
```

Run the live probe when network behavior matters:

```bash
node scripts/fetch-articles-smoke-test.mjs --workflow --since=2026-04-27 --until=2026-05-27 --ignore-state
```

Run only one journal source while debugging an adapter:

```bash
node scripts/fetch-articles-smoke-test.mjs --source=j9
```

For discovery-only fallback sources such as `j6` (`管理世界`, Macrodatas) and `j7` (`南开管理评论`, Macrodatas), the fallback page must not be used as the frontend article link. `j6` now queries the NCPSD mobile issue page from the discovered year/issue, matches titles, and exposes `Literature/articleinfo` as the official single-article link. Keep `Literature/readurl` as auxiliary metadata only, because direct external clicks can redirect to login. `j7` leaves `url` empty when NCPSD has not listed matching article pages yet. Do not build CNKI links from issue order alone; those links can land on the wrong article and should remain `needs_official_pdf` until title-level matching confirms an official destination. `j10` (`中国行政管理`) still uses CQVIP for discovery, but its current rule resolves matching titles to NCPSD article detail pages before the frontend receives them.

Check current unresolved official-link work:

```bash
node -e 'const fs=require("fs"); const raw=fs.readFileSync("data/recent-front-data.js","utf8"); const data=JSON.parse(raw.replace(/^window\.RECENT_WORKFLOW_DATA = /,"").replace(/;\s*$/,"")); console.log(data.push_queue.filter(a=>a.link_status==="needs_official_pdf").map(a=>`${a.journal_name}: ${a.title}`).join("\n"))'
```

Rebuild frontend data from a workflow file:

```bash
node scripts/build-adapter-front-data.mjs
node scripts/build-front-data.mjs --workflow=data/recent-articles-2026-04-27_2026-05-27.json
```

Use `--reset-history` only when intentionally reseeding the whole frontend history:

```bash
node scripts/build-front-data.mjs --reset-history --workflow=data/recent-articles-2026-04-27_2026-05-27.json
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

The daily script writes a one-day workflow file such as `data/recent-articles-2026-05-28_2026-05-28.json`. If no new push articles are found, `data/recent-front-data.js` is left unchanged. If new articles are found, `scripts/build-front-data.mjs` merges them into `data/push-history.json` and regenerates `data/recent-front-data.js`.

## Source Troubleshooting

Classify failures before changing adapters:

- Network or DNS failure: local environment problem; retry from the same Mac before editing rules.
- HTTP protection such as 403, 412, CAPTCHA, or WAF: prefer an official feed, public API, Crossref/OpenAlex, or a stable catalog fallback.
- Parser failure: fetch succeeds but titles, dates, authors, or URLs are wrong; patch the adapter and add or update a focused test.
- No explicit article date: keep the article in first-seen flow instead of dropping it.
- Host instability such as `管理科学学报` returning 503 or TLS timeouts: keep the automated fallback rule, preserve prior source state, and let the next successful daily run discover and push missed items by first-seen date.
- A single `中国行政管理` / CQVIP timeout such as `curl: (28) Operation timed out after 22002 milliseconds` should be treated as network/protection first. Preserve the existing NCPSD resolver rule and retry the same source before changing parser code.

Do not mark a source ready unless the live probe returns usable article samples or a documented automated fallback.

## Git Policy

Use local git commits for checkpoints. Do not push to GitHub unless the user explicitly asks for it.
