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

These two methods are static previews only. They do not provide Vercel auth functions or a production-like proxy path, so do not use them to validate login, roles, admin visibility, or workflow ownership.

## Local Checks

Run the pure checks before committing script or frontend-data changes:

```bash
node scripts/adapter-fallback-test.mjs
node scripts/fetch-retry-policy-test.mjs
node scripts/article-link-policy-test.mjs
node scripts/ajcass-link-policy-test.mjs
node scripts/official-link-resolvers-test.mjs
node scripts/backfill-nankai-official-links-test.mjs
node scripts/macrodatas-url-test.mjs
node scripts/recent-workflow-test.mjs
node scripts/front-data-history-test.mjs
node scripts/html-adapter-parsers-test.mjs
node scripts/date-enhancement-test.mjs
node scripts/pdf-abstract-backfill-test.mjs
node scripts/daily-abstract-backfill-test.mjs
node scripts/abstract-quality-test.mjs
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
node --check scripts/backfill-nankai-official-links.mjs
node --check scripts/backfill-ncpssd-abstracts.mjs
node --check scripts/backfill-ncpssd-issue-abstracts.mjs
node --check scripts/backfill-pdf-abstracts.mjs
node --check scripts/backfill-official-html-abstracts.mjs
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

For mock-mode smoke tests, set `WORKFLOW_USE_MOCKS=true` in `backend/.env`. Protected APIs also require `SCIENCE_WORKSHOP_PROXY_SECRET` and a non-empty trusted `x-workshop-user`; if the secret is absent, FastAPI returns `503` by default, while a valid secret without a user returns `401`. `WORKFLOW_ALLOW_INSECURE_DIRECT_ACCESS=true` is an explicit single-user localhost escape hatch for narrow backend tests only and must stay `false` in production. Real MinerU and DeepSeek runs require:

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

## Production-Like Local Verification

Use two terminals so local requests follow the same cookie -> Vercel proxy -> shared secret -> FastAPI path as production.

Terminal A starts the mock FastAPI backend:

```bash
cd /Users/yuzhou4tc/Public/工作坊/journal-workshop-prototype/backend
SCIENCE_WORKSHOP_PROXY_SECRET=local-proxy-secret \
WORKFLOW_USE_MOCKS=true \
.venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8000
```

Terminal B generates disposable local password hashes and starts the Vercel layer:

```bash
cd /Users/yuzhou4tc/Public/工作坊/journal-workshop-prototype
ADMIN_HASH="$(node -e "const c=require('node:crypto');const p=process.argv[1];const s=c.randomBytes(16).toString('base64url');console.log('scrypt:'+s+':'+c.scryptSync(p,s,32).toString('base64url'));" 'admin-pass')"
USER_HASH="$(node -e "const c=require('node:crypto');const p=process.argv[1];const s=c.randomBytes(16).toString('base64url');console.log('scrypt:'+s+':'+c.scryptSync(p,s,32).toString('base64url'));" 'user-pass')"
SCIENCE_WORKSHOP_BACKEND_ORIGIN=http://127.0.0.1:8000 \
SCIENCE_WORKSHOP_BACKEND_PREFIX='' \
SCIENCE_WORKSHOP_PROXY_SECRET=local-proxy-secret \
WORKSHOP_ADMIN_USERNAME=admin \
WORKSHOP_ADMIN_PASSWORD_HASH="$ADMIN_HASH" \
WORKSHOP_USER_USERNAME=user \
WORKSHOP_USER_PASSWORD_HASH="$USER_HASH" \
WORKSHOP_SESSION_SECRET=local-session-secret-change-me \
vercel dev --listen 4173
```

Open `http://127.0.0.1:4173`. Test accounts are `admin / admin-pass` and `user / user-pass`. Verify login, page refresh/session restore, ordinary-user restrictions, admin inbox visibility, logout, and that exactly one main page is visible at a time. These credentials are process-local and should not be reused elsewhere.

The following direct FastAPI curl examples assume `WORKFLOW_ALLOW_INSECURE_DIRECT_ACCESS=true` in an isolated local test process. Prefer the production-like two-process path above for auth/RBAC checks.

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
- Bind the API container to localhost as `127.0.0.1:18080:8000`, then expose it through Nginx at `/science-workshop-api/`. The checked-in Nginx template uses this exact host port.
- Persist workflow records with `/opt/science-workshop/storage/workflow_jobs:/data/workflow_jobs` and mount `/opt/science-workshop/repo/data:/opt/science-workshop/repo/data` so FastAPI approvals and the host Node crawler share `community-sources.json`.
- Leave only required firewall ports open. For this deployment: 22 for SSH, 80 for HTTP, and 443 only after TLS is configured.
- Back up Nginx config and `api.env` before edits, then run `nginx -t` before reload.

### Public-IP HTTPS (default, no domain required)

The default production path keeps the frontend and auth proxy on Vercel and exposes the Tencent Cloud FastAPI backend through the server's public IP:

```text
Vercel -> https://<PUBLIC_IP>/science-workshop-api/ -> Nginx -> 127.0.0.1:18080 -> FastAPI
```

保留现有 OpenClaw 站点的 Nginx server、location 和 upstream；仅合并 ACME challenge、IP TLS 证书和 `/science-workshop-api/` location。

Do not overwrite `/etc/nginx/nginx.conf`, replace the OpenClaw site file wholesale, or leave two `default_server` declarations on port 443. Inspect and back up `sudo nginx -T` before changing the live host. The checked-in template is a merge reference, not a complete replacement for the live OpenClaw configuration.

IP address certificates require Certbot 5.4+ for `webroot` support and Let's Encrypt's `shortlived` profile. They are valid for about 160 hours, so a working automatic renewal timer and Nginx deploy hook are release blockers. First make `/var/www/acme/.well-known/acme-challenge/` publicly readable through the existing port-80 server, then test against staging:

```bash
certbot --version
sudo certbot certonly --staging \
  --preferred-profile shortlived \
  --webroot \
  --webroot-path /var/www/acme \
  --ip-address <PUBLIC_IP>
```

After staging succeeds, run the same command once without `--staging`. Certbot currently obtains but does not install IP certificates into Nginx, so point Nginx at `/etc/letsencrypt/live/<PUBLIC_IP>/fullchain.pem` and `/etc/letsencrypt/live/<PUBLIC_IP>/privkey.pem`. Persist and test the successful-renewal reload hook:

```bash
sudo certbot reconfigure \
  --cert-name <PUBLIC_IP> \
  --preferred-profile shortlived \
  --webroot \
  --webroot-path /var/www/acme \
  --ip-address <PUBLIC_IP> \
  --deploy-hook "systemctl reload nginx" \
  --run-deploy-hooks
sudo certbot renew --dry-run
systemctl list-timers
sudo nginx -t
```

Only after the public HTTPS health URL passes, set these Vercel Preview variables and run the browser acceptance flow before copying them to Production:

```text
SCIENCE_WORKSHOP_BACKEND_ORIGIN=https://<PUBLIC_IP>
SCIENCE_WORKSHOP_BACKEND_PREFIX=/science-workshop-api
```

If a backend domain is added later, the same proxy path remains valid: replace the public host and certificate paths, use `SCIENCE_WORKSHOP_BACKEND_ORIGIN=https://<BACKEND_DOMAIN>`, and revalidate in Preview. A domain is optional for the current deployment and must not block the public-IP route. The full, ordered procedure is in [the HTTPS launch checklist](https-launch-checklist.md).

Workflow calls from the Vercel page are protected by a signed session cookie at the Vercel proxy layer and by a shared proxy secret at the FastAPI layer. Set these values outside the repository:

```text
Vercel environment variables:
WORKSHOP_ADMIN_USERNAME=<admin login username>
WORKSHOP_ADMIN_PASSWORD_HASH=<scrypt password hash>
WORKSHOP_USER_USERNAME=<ordinary login username>
WORKSHOP_USER_PASSWORD_HASH=<scrypt password hash>
WORKSHOP_SESSION_SECRET=<random session signing secret>
SCIENCE_WORKSHOP_PROXY_SECRET=<same value as backend>

Backend /opt/science-workshop/api.env:
SCIENCE_WORKSHOP_PROXY_SECRET=<same value as Vercel>
WORKFLOW_STORAGE_DIR=/data/workflow_jobs
SCIENCE_WORKSHOP_RUNTIME_SOURCES_PATH=/opt/science-workshop/repo/data/community-sources.json
WORKFLOW_ALLOW_INSECURE_DIRECT_ACCESS=false
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

Prepare the two host directories before starting the container, then use the same bind mounts on every replacement or restart:

```bash
sudo mkdir -p /opt/science-workshop/storage/workflow_jobs /opt/science-workshop/repo/data
docker run -d --name science-workshop-api \
  --env-file /opt/science-workshop/api.env \
  -p 127.0.0.1:18080:8000 \
  -v /opt/science-workshop/storage/workflow_jobs:/data/workflow_jobs \
  -v /opt/science-workshop/repo/data:/opt/science-workshop/repo/data \
  science-workshop-api:local
```

`WORKFLOW_STORAGE_DIR` holds workflow jobs, source requests, and inbox records. `SCIENCE_WORKSHOP_RUNTIME_SOURCES_PATH` must point at the mounted repository data directory because the host Node daily task reads `/opt/science-workshop/repo/data/community-sources.json`. Do not use an unmounted container-only path for either setting.

Workflow concurrency is enforced inside the FastAPI process. The current Docker command starts one uvicorn worker, so these limits apply process-wide: at most 3 running workflow jobs, with paper reading capped at 1 running job and WeChat writing capped at 2. A single logged-in user can have 1 running workflow and 2 queued workflows; daily quotas are 3 paper-reading jobs and 10 WeChat-writing jobs per user, counted by the configured quota timezone.

All job reads and mutations are owner-scoped. A normal account may access only its own status, artifacts, edits, exports, reruns, SSE events, referenced paper evidence, and chunked uploads; an admin may access any owner. A `403` on these routes indicates an ownership/role mismatch rather than a missing job. Multi-file WeChat material uploads are preflighted as one set; if any upload is missing, incomplete, oversized, or owned by someone else, no job is kept and none of the staged uploads are deleted.

User-submitted data-source contributions are appended to `WORKFLOW_STORAGE_DIR/source-requests.jsonl` with `intake_status=pending_auto_probe`, then probed asynchronously through `probing → probe_succeeded / needs_manual_review / probe_failed`. Admin-only `POST /api/sources/import?mode=preview|commit` handles UTF-8/BOM CSV and first-sheet XLSX (2 MB, 500 rows) without bypassing this queue. Approval writes `data/community-sources.json` atomically; the Node crawler merges only approved runtime candidates on its next start. The fixed `data/adapter-profiles.json` is not modified.

WeChat draft imports currently run in a reserved mock/record mode. The frontend "生成导入记录" action posts Markdown to `/api/wechat-drafts`, and the backend appends the payload to `WORKFLOW_STORAGE_DIR/wechat-draft-imports.jsonl` with `mode=mock` and `status=prepared`; admins can inspect these records in the inbox. This does not call the WeChat Official Account API yet; real draft-box publishing should be wired here after the account credentials, media upload permissions, and draft API access are confirmed.

Generate the password hash locally with:

```bash
node -e "const c=require('node:crypto');const p=process.argv[1];const s=c.randomBytes(16).toString('base64url');console.log('scrypt:'+s+':'+c.scryptSync(p,s,32).toString('base64url'));" '<password>'
```

The legacy `WORKSHOP_AUTH_USERNAME` / `WORKSHOP_AUTH_PASSWORD_HASH` pair is still accepted and is treated as an admin account, but new deployments should prefer the explicit admin/user variables above.

Current production health checks (run only after the HTTPS launch checklist is completed; this local round does not execute them):

```bash
curl -s http://127.0.0.1:18080/api/health
curl -fsS https://<PUBLIC_IP>/science-workshop-api/api/health
curl -fsS https://<VERCEL_ORIGIN>/science-workshop-api/api/health
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

For a one-time local recovery of every article whose abstract is still empty,
run the same ordered source pipeline with `--all-missing`. Each successful
step is merged before the next step and a coverage report is written to
`data/abstract-backfill-report-<date>.json`:

```bash
node scripts/backfill-daily-abstracts.mjs --all-missing --ocr
```

Historical `南开管理评论` official-link recovery is a separate, title-level
workflow. It first accepts normalized exact matches, then allows a unique
same-issue candidate only when its title similarity is at least 0.8 and leads
the runner-up by at least 0.1. When a known issue yields no match, it scans the
other numbered issues in that year and all six issues in the previous year before trying the
Nankai archive. It only accepts `ncpssd.cn` or
`nbr.nankai.edu.cn` links, keeps evidence for protected or unmatched pages,
and never fabricates CNKI filenames. Successful matches are merged into the
cumulative frontend data automatically:

```bash
node scripts/backfill-nankai-official-links.mjs
```

The date-scoped command only targets articles in `data/push-history.json` whose `first_seen_at` equals the requested date and whose `abstract` is still missing. It writes per-source files such as:

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
node scripts/backfill-official-html-abstracts.mjs --first-seen-at=2026-06-06 --timeout-ms=15000 --delay-ms=300
node scripts/backfill-english-metadata-abstracts.mjs --first-seen-at=2026-06-06 --semantic-scholar --timeout-ms=15000 --delay-ms=1200
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
