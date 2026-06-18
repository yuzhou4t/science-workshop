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
node scripts/pdf-abstract-backfill-test.mjs
node scripts/daily-abstract-backfill-test.mjs
node scripts/topic-search-index-test.mjs
node scripts/daily-topic-search-workflow-test.mjs
node scripts/launchd-plist-test.mjs
node scripts/build-adapter-front-data-test.mjs
node scripts/adapter-smoke-test.mjs
node --check scripts/fetch-articles-smoke-test.mjs
node --check scripts/build-front-data.mjs
node --check scripts/build-adapter-front-data.mjs
node --check scripts/build-topic-search-index.mjs
node --check scripts/run-daily-workflow.mjs
node --check scripts/backfill-daily-abstracts.mjs
node --check scripts/backfill-ncpssd-abstracts.mjs
node --check scripts/backfill-ncpssd-issue-abstracts.mjs
node --check scripts/backfill-pdf-abstracts.mjs
node --check scripts/backfill-english-metadata-abstracts.mjs
node --check scripts/backfill-macrodatas-abstracts.mjs
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

## Backend Deployment

Keep deploys split by sensitivity:

- Commit application code, Docker files, tests, and public frontend data to GitHub.
- Keep `.env`, `api.env`, DeepSeek keys, MinerU keys, and Tencent COS secrets only on the server.
- Upload backend code with SSH/SCP/rsync or by pulling Git on the server. Do not upload local virtualenvs, storage, caches, logs, or secrets.
- Build the Docker image on the server from `backend/Dockerfile`; run it with `--env-file /opt/science-workshop/api.env`.
- Bind the API container to localhost, for example `127.0.0.1:18080:8000`, then expose it through Nginx at `/science-workshop-api/`.
- Leave only required firewall ports open. For this deployment: 22 for SSH, 80 for HTTP, and 443 only after TLS is configured.
- Back up Nginx config and `api.env` before edits, then run `nginx -t` before reload.

Workflow calls from the Vercel page are protected by a signed session cookie at the Vercel proxy layer and by a shared proxy secret at the FastAPI layer. Set these values outside the repository:

```text
Vercel environment variables:
WORKSHOP_AUTH_USERNAME=<login username>
WORKSHOP_AUTH_PASSWORD_HASH=<scrypt password hash>
WORKSHOP_SESSION_SECRET=<random session signing secret>
SCIENCE_WORKSHOP_PROXY_SECRET=<same value as backend>

Backend /opt/science-workshop/api.env:
SCIENCE_WORKSHOP_PROXY_SECRET=<same value as Vercel>
WORKFLOW_RETENTION_DAYS=3
WORKFLOW_MAX_RUNNING_JOBS=3
WORKFLOW_PAPER_READING_MAX_RUNNING_JOBS=1
WORKFLOW_WECHAT_WRITING_MAX_RUNNING_JOBS=2
WORKFLOW_MAX_RUNNING_JOBS_PER_USER=1
WORKFLOW_MAX_QUEUED_JOBS_PER_USER=2
WORKFLOW_PAPER_READING_DAILY_QUOTA_PER_USER=3
WORKFLOW_WECHAT_WRITING_DAILY_QUOTA_PER_USER=10
WORKFLOW_QUOTA_TIMEZONE=Asia/Shanghai
```

Workflow concurrency is enforced inside the FastAPI process. The current Docker command starts one uvicorn worker, so these limits apply process-wide: at most 3 running workflow jobs, with paper reading capped at 1 running job and WeChat writing capped at 2. A single logged-in user can have 1 running workflow and 2 queued workflows; daily quotas are 3 paper-reading jobs and 10 WeChat-writing jobs per user, counted by the configured quota timezone.

Generate the password hash locally with:

```bash
node -e "const c=require('node:crypto');const p=process.argv[1];const s=c.randomBytes(16).toString('base64url');console.log('scrypt:'+s+':'+c.scryptSync(p,s,32).toString('base64url'));" '<password>'
```

Current production health checks:

```bash
curl -s http://127.0.0.1:18080/api/health
curl -s http://106.53.153.215/science-workshop-api/api/health
curl -s https://journal-workshop-prototype.vercel.app/science-workshop-api/api/health
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

## Abstract Backfill

Daily runs automatically attempt abstract backfill after new push articles are merged. To run the same backfill manually for one first-seen date:

```bash
node scripts/backfill-daily-abstracts.mjs --first-seen-at=2026-06-06
```

This command only targets articles in `data/push-history.json` whose `first_seen_at` equals the requested date and whose `abstract` is still missing. It writes per-source files such as:

- `data/recent-articles-daily-ncpssd-direct-<date>.json`
- `data/recent-articles-daily-ncpssd-issue-<date>.json`
- `data/recent-articles-daily-pdf-<date>.json`
- `data/recent-articles-daily-english-metadata-<date>.json`
- `data/recent-articles-daily-macrodatas-<date>.json`

Successful backfill files are merged automatically by the daily backfill script through `scripts/build-front-data.mjs`. To inspect or rerun one source directly:

```bash
node scripts/backfill-ncpssd-abstracts.mjs --first-seen-at=2026-06-06 --timeout-ms=30000 --delay-ms=8000 --retries=3
node scripts/backfill-ncpssd-issue-abstracts.mjs --first-seen-at=2026-06-06 --journals=中国工业经济,会计研究 --timeout-ms=25000 --delay-ms=5000 --retries=3
node scripts/backfill-pdf-abstracts.mjs --first-seen-at=2026-06-06 --journals=经济研究,中国农村经济 --ocr --fetch-timeout-ms=180000 --pages=3
node scripts/backfill-english-metadata-abstracts.mjs --first-seen-at=2026-06-06 --timeout-ms=15000 --delay-ms=1200
node scripts/backfill-macrodatas-abstracts.mjs --first-seen-at=2026-06-06 --journals=中国工业经济,会计研究
```

OCR for scanned official PDFs requires:

```bash
tesseract --version
pdftoppm -v
tesseract --list-langs | rg 'chi_sim|eng'
```

Install missing OCR dependencies with Homebrew:

```bash
/opt/homebrew/bin/brew install tesseract tesseract-lang poppler
```

PDF and OCR caches live under `data/.pdf-cache/` and are ignored by git. Delete an individual cached PDF only when a prior download was incomplete or `pypdf` / `pdftoppm` reports a corrupt file.

Use `--reset-history` only when intentionally reseeding the whole frontend history:

```bash
node scripts/build-front-data.mjs --reset-history --workflow=data/recent-articles-2026-04-27_2026-05-27.json
```

## Topic Search Index

The frontend topic-search page reads `data/topic-search-index.js`. Rebuild it from the cumulative push history after changing `data/search-tags.json` or after manually changing `data/push-history.json`:

```bash
node scripts/build-topic-search-index.mjs
```

The builder scans the full `data/push-history.json` article list. It skips rewriting `data/topic-search-index.js` when only `updated_at` would change, so it is safe to run from a daily job without creating timestamp-only commits.

## Daily Scheduler

Production scheduling runs on the Tencent Cloud server, not the local Mac:

```text
Server repo: /opt/science-workshop/repo
Wrapper: /opt/science-workshop/run-daily-publish.sh
Cron: 0 11 * * *
```

The wrapper fast-forwards `main`, runs `node scripts/run-daily-publish.mjs`, and writes logs to:

- `/opt/science-workshop/logs/daily-publish.log`
- `/opt/science-workshop/logs/daily-publish.error.log`

Check server scheduler state:

```bash
ssh root@106.53.153.215 'crontab -l'
```

Run the server publish workflow manually:

```bash
ssh root@106.53.153.215 '/opt/science-workshop/run-daily-publish.sh'
```

Keep the server repo Git author as the Vercel-recognized account:

```bash
ssh root@106.53.153.215 'git -C /opt/science-workshop/repo config user.name'
ssh root@106.53.153.215 'git -C /opt/science-workshop/repo config user.email'
```

The local macOS LaunchAgent file is retained only as a fallback and is currently disabled/unloaded. Its fallback schedule is also 11:00 Beijing time, matching the server schedule that leaves a buffer for source pages that publish after 10:00:

```text
/Users/yuzhou4tc/Library/LaunchAgents/com.science-workshop.daily.plist
```

## Logs

Server scheduled publish logs:

- `/opt/science-workshop/logs/daily-publish.log`
- `/opt/science-workshop/logs/daily-publish.error.log`

Local manual workflow logs, when `scripts/run-daily-publish.mjs` is run from this Mac:

- `logs/daily-workflow.log`
- `logs/daily-workflow.error.log`

The daily script writes a one-day workflow file such as `data/recent-articles-2026-05-28_2026-05-28.json`. If no new push articles are found, `data/recent-front-data.js` is left unchanged. If new articles are found, `scripts/build-front-data.mjs` merges them into `data/push-history.json` and regenerates `data/recent-front-data.js`.

If new push articles are found, the daily script then runs abstract backfill for the same first-seen date. Backfill files update `data/push-history.json` and `data/recent-front-data.js` but do not rewrite `data/source-state.json`.

After front-data and best-effort abstract-backfill work, the daily script refreshes `data/topic-search-index.js` from the cumulative push history. Abstract backfill steps have process-level timeouts; a slow PDF/OCR step can fail without blocking the daily article push. After the daily workflow finishes, `scripts/run-daily-publish.mjs` commits only the generated daily data files plus cumulative state files and the topic-search index, then pushes them to `origin/main`, which lets Vercel deploy the refreshed static page. If the git index already has staged files, the publish step skips to avoid mixing user work into the automated commit.

## Source Troubleshooting

Classify failures before changing adapters:

- Network or DNS failure: local environment problem; retry from the same Mac before editing rules.
- HTTP protection such as 403, 412, CAPTCHA, or WAF: prefer an official feed, public API, Crossref/OpenAlex, or a stable catalog fallback.
- Parser failure: fetch succeeds but titles, dates, authors, or URLs are wrong; patch the adapter and add or update a focused test.
- No explicit article date: keep the article in first-seen flow instead of dropping it.
- Host instability such as `管理科学学报` returning 503 or TLS timeouts: keep the automated fallback rule, preserve prior source state, and let the next successful daily run discover and push missed items by first-seen date.
- A single `中国行政管理` / CQVIP timeout such as `curl: (28) Operation timed out after 22002 milliseconds` should be treated as network/protection first. Preserve the existing NCPSD resolver rule and retry the same source before changing parser code.
- NCPSD article API failures with `json_parse_failed`, `fetch failed`, or `timeout` are usually request timing or transient network problems. Retry with slower spacing, such as `--delay-ms=8000 --retries=3`, before changing parser code.
- `中国工业经济` and `会计研究` official detail pages can return WAF/verification or login pages. Do not bypass those pages; try `scripts/backfill-ncpssd-issue-abstracts.mjs` first. If an NCPSD issue page returns zero candidates for a needed issue, keep the article visible without an abstract and retry after that issue is listed.
- `中国农村经济` official PDFs may be scanned images. Use PDF text extraction first, then OCR. If OCR text has no `摘要` / `关键词` block, the article may be a meeting review or similar non-standard item rather than an extraction failure.
- English publisher pages protected by Cloudflare or 403 should be backfilled only from open metadata sources. If Crossref/OpenAlex/Semantic Scholar do not expose an abstract, leave the article without an abstract rather than scraping protected pages.

Do not mark a source ready unless the live probe returns usable article samples or a documented automated fallback.

## Git Policy

Use local git commits for checkpoints. Do not push to GitHub unless the user explicitly asks for it.
