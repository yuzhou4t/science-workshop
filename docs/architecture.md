# Architecture

Science Workshop combines a static frontend, Node.js crawler scripts, Vercel authentication/proxy functions, and a FastAPI workflow backend. The page can still be opened from disk for data-only inspection, while authenticated workflows use the Vercel proxy and the crawler remains a separate local/server process.

## Data Flow

1. Journal metadata is embedded in `index.html` from the original Excel-based source list.
2. Source access rules live in `data/adapter-profiles.json`.
3. `scripts/fetch-articles-smoke-test.mjs` probes all direct feeds and adapter sources.
4. Live probe results are written to `data/fetch-smoke-results.json`.
5. When run with `--workflow`, the probe also writes `data/recent-articles-<since>_<until>.json`.
6. `scripts/build-adapter-front-data.mjs` converts the adapter registry into `data/adapter-front-data.js`.
7. `scripts/build-front-data.mjs` merges a workflow file into `data/push-history.json`.
8. `scripts/build-front-data.mjs` generates `data/recent-front-data.js` from the cumulative push history.
9. `scripts/backfill-daily-abstracts.mjs` can run after a successful daily push merge. It only targets articles with the requested `first_seen_at` and missing `abstract`, then merges successful backfill workflow files through `scripts/build-front-data.mjs`.
10. `index.html` reads `window.ADAPTER_PROFILE_DATA` for the adapter workbench and `window.RECENT_WORKFLOW_DATA` for the timeline.

## Source Model

`data/adapter-profiles.json` has three main sections:

- `direct_article_feeds`: 5 direct RSS/eTOC article feeds.
- `adapter_queue`: 17 sources that need HTML, public API, DOI, or metadata adapters.
- `platform_profiles`: 7 platform families that describe extraction strategy and expected fields.

The current source set has 22 monitored sources. A source can discover article metadata before it has a verified official article/PDF link, so the frontend now keeps `url` only for official detail/PDF links and moves directory-only fallback links into `discovery_url`.

Important fallback patterns:

- AJCass JSON APIs for `经济研究` and `中国农村经济`.
- Legacy or static HTML rules for `中国工业经济`, `世界经济`, `金融研究`, `公共管理学报`, `管理科学学报`, `AMERICAN ECONOMIC REVIEW`, and `ADMINISTRATIVE SCIENCE QUARTERLY`.
- `管理科学学报` first uses its current issue-browser pages and falls back to the older `ch/reader/issue_query.aspx` page, which exposes title, authors, and issue metadata in one page when the host is reachable.
- Macrodatas issue/article-section pages for protected Chinese journal catalog pages such as `管理世界` and `南开管理评论`. These pages expose titles, authors, abstracts, and review-cycle notes, but they are discovery sources only. `管理世界` uses the discovered year/issue to query the NCPSD mobile issue page, matches official titles, and exposes `Literature/articleinfo` as the frontend article link; `Literature/readurl` is retained only as an auxiliary reader/download URL because direct external clicks can redirect to login. `南开管理评论` uses the same title-matching pattern and stays `needs_official_pdf` until a resolver returns matched official article pages. The workflow must not construct CNKI detail links from issue order alone, because that can produce wrong article destinations.
- CQVIP catalog extraction for `中国行政管理`, followed by an NCPSD issue-page resolver that matches titles to public article detail pages. CQVIP links remain discovery-only and are stored in `discovery_url`.
- ASC current issue pages for `会计研究`.
- Crossref/OpenAlex metadata fallback for publisher pages that return 403.

`scripts/article-link-policy.mjs` is the gatekeeper for clickable article links. Rules such as `macrodatas-issue-list` and `cqvip-journal-html` cannot populate the frontend click URL directly; they must first be resolved to an official `official_url` or `pdf_url`. Paid official access, such as CNKI detail pages requiring personal payment or institutional access, is marked `official_paid_detail` and remains clickable.

`scripts/recent-workflow-lib.mjs` canonicalizes `j1` into `j14` so `JOURNAL OF FINANCE` forthcoming-page extraction and Wiley RSS extraction do not create duplicate journal cards.

## Abstract Backfill Model

Article discovery and abstract enrichment are separate phases. The discovery workflow should push a new article once it is found; missing abstracts are then backfilled through narrow workflow files marked `summary.abstract_backfill = true`. `scripts/build-front-data.mjs` preserves existing publication/issue dates for those backfill files and only fills fields such as `abstract`, `keywords`, `reader_url`, and `official_source`.

The daily abstract entrypoint is `scripts/backfill-daily-abstracts.mjs --first-seen-at=<YYYY-MM-DD>`. It reads the cumulative `data/push-history.json`, selects only newly pushed articles from that first-seen date that still lack an abstract, and runs these sources in order:

1. `scripts/backfill-ncpssd-abstracts.mjs` for articles already pointing at NCPSD `Literature/articleinfo`.
2. `scripts/backfill-ncpssd-issue-abstracts.mjs` for journals whose official pages are blocked but NCPSD has a public issue page, currently `中国工业经济` (`gch=93800A`) and `会计研究` (`gch=96456X`).
3. `scripts/backfill-pdf-abstracts.mjs` for official PDF links from `经济研究` and `中国农村经济`; it tries PDF text first and uses OCR only when `--ocr` is enabled.
4. `scripts/backfill-english-metadata-abstracts.mjs` for English journals via Crossref DOI, OpenAlex DOI/title, and optional Semantic Scholar DOI.
5. `scripts/backfill-macrodatas-abstracts.mjs` for Macrodatas issue pages when they cover the needed issue.

The model deliberately avoids bypassing login pages, CAPTCHAs, WAF, or Cloudflare. For protected sources, it prefers public issue pages, public article APIs, PDF text/OCR for official PDFs, and open metadata. If a source returns no matching issue or no abstract, the article remains visible without an abstract and the generated backfill result file records the failure reason.

OCR is a last-layer fallback, not the default. On this Mac it expects `tesseract`, `tesseract-lang` with `chi_sim`, and `poppler`/`pdftoppm` on PATH; `data/.pdf-cache/abstract-backfill/` and `data/.pdf-cache/abstract-backfill-ocr/` cache downloads and OCR text and are ignored by git.

## Date And Push Model

Article dates are normalized into three fields:

- `published_at`: exact article publication date when available.
- `issue_date`: issue month or issue date when publication date is missing.
- `first_seen_at`: the first local discovery date stored in `data/source-state.json`.

The frontend push timeline is intentionally sorted by `first_seen_at`. Publication date and issue date are shown as metadata, but they do not push an article back into an older timeline position after the workshop first discovers it.

`data/source-state.json` prevents duplicate daily pushes. `data/push-history.json` preserves every article already pushed to the frontend, so rebuilding from a one-day workflow appends or updates rows instead of replacing the timeline with that one day only.

Push inclusion uses this priority:

1. Push newly discovered articles with `published_at` inside the selected window.
2. Push newly discovered articles whose issue overlaps the selected window.
3. Push newly discovered future-issue items once, using first-seen.
4. Push newly discovered undated candidates once, using first-seen, so no-date sources are not silently dropped.

## Daily Workflow

`scripts/run-daily-workflow.mjs` is the production-like local workflow entrypoint, and `scripts/run-daily-publish.mjs` is the scheduled publish entrypoint.

It runs `scripts/fetch-articles-smoke-test.mjs --workflow --daily`. If `data/source-state.json` is not initialized, it adds `--baseline`, records existing articles, and avoids pushing historical backlog. Later daily runs only rebuild frontend data when the push queue contains newly discovered articles; the rebuild merges into cumulative history instead of replacing it.

When a later daily run has new push articles, `scripts/run-daily-workflow.mjs` rebuilds the frontend history first and then calls `scripts/backfill-daily-abstracts.mjs --first-seen-at=<daily date>`. Abstract backfill output files are merged back into `data/push-history.json` and `data/recent-front-data.js`; they do not rewrite `data/source-state.json`.

Production scheduling now runs from Tencent Cloud cron via `/opt/science-workshop/run-daily-publish.sh`. The local macOS LaunchAgent generated by `scripts/launchd-plist.mjs` and installed by `scripts/install-daily-launchd.mjs` remains a fallback only; the local job is disabled to avoid duplicate automated commits. The scheduled publish job runs `scripts/run-daily-publish.mjs`, which commits only generated daily data and pushes `origin/main` after a successful workflow.

## Auth And Workflow Access

Authenticated browser requests follow this path:

1. `/api/auth/login` verifies a configured scrypt password hash and sets an eight-hour signed `science_workshop_session` cookie.
2. `/science-workshop-api/*` reaches the Vercel proxy, which canonicalizes the backend path before authorization, validates the session for protected routes, and replaces any client-supplied user/role headers.
3. Only authenticated protected requests receive the shared `SCIENCE_WORKSHOP_PROXY_SECRET` plus trusted `x-workshop-user` and `x-workshop-role` headers; public health requests receive none of them.
4. FastAPI rejects protected routes when the shared secret is missing/invalid or the trusted user header is empty. `WORKFLOW_ALLOW_INSECURE_DIRECT_ACCESS=true` exists only for isolated local tests.

Workflow jobs store an `owner_id`. Job status, artifacts, edits, DOCX export, rerun planning, SSE events, referenced paper-reading evidence, and chunked upload staging are accessible only to the same owner or an administrator. Issue-table export jobs follow the same ownership rule. Multi-file material uploads are fully preflighted before a job is created, so an ownership or completeness failure does not consume earlier uploads or leave an orphan job.

The protected backend route families are `/api/workflows`, `/api/jobs`, `/api/source-requests`, and `/api/wechat-drafts`. Source submissions are append-only records with `pending_auto_probe`; they do not mutate `data/adapter-profiles.json`, and the automatic probe runner is not implemented yet. WeChat draft imports are also append-only `prepared/mock` records until real account credentials, media upload, and draft API access are available.

## Frontend

`index.html` is intentionally static. It contains:

- Sidebar navigation for real-time tracking, topic search, source contribution, admin-only maintenance, and content workflows.
- Collapsible filters where language is the first priority, then subject and journal tags.
- Date range filtering over push dates.
- Timeline cards that show authors, publication date, issue date, extraction rule, and source status.
- Source inventory tables and adapter planning views.
- Login/logout with ordinary and admin roles; admin-only pages remain hidden for other roles.
- Paper reading, WeChat writing, issue-table export, and an admin inbox for source requests and mock draft-import records.

The page falls back to sample source cards if `data/recent-front-data.js` is missing.
