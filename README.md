# Science Workshop

这是一个用于“期刊追踪工作坊”的本地原型项目。它包含一个可直接打开的前端页面，以及一套本地运行的期刊文章抓取流程，用来持续观察目标期刊是否有新文章发布。

这个项目目前适合做三件事：

- 展示近一段时间抓到的期刊文章推送流。
- 管理期刊官网、过刊页、样例文章、RSS 或替代数据源。
- 用论文精读、公众号写作和期刊目录导出工作流处理已抓取内容。

## 快速开始

只查看静态页面和已生成数据：

```bash
open index.html
```

直接打开文件不能验证登录、角色、管理员信箱或工作流 API。完整本地验收需同时启动 FastAPI 与 `vercel dev`，具体命令见 [运行手册](docs/runbook.md#production-like-local-verification)。

运行不依赖外网的基础检查：

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
node --check scripts/build-topic-search-index.mjs
node --check scripts/run-daily-publish.mjs
node scripts/launchd-plist-test.mjs
node scripts/build-adapter-front-data-test.mjs
node scripts/adapter-smoke-test.mjs
```

手动跑一次指定日期范围的真实抓取，并把结果写入前端数据：

```bash
node scripts/fetch-articles-smoke-test.mjs --workflow --since=2026-04-27 --until=2026-05-27 --ignore-state
node scripts/build-front-data.mjs --reset-history --workflow=data/recent-articles-2026-04-27_2026-05-27.json
```

## 主要文件

- `index.html`：前端工作台，包含文章推送流、主题检索、数据源共建、角色权限和内容工作流。
- `data/adapter-profiles.json`：期刊数据源规则表，目前包含 5 个直接 RSS/eTOC 来源和 17 个页面适配来源。
- `data/fetch-smoke-results.json`：全量真实探测所有数据源后的结果。
- `data/adapter-front-data.js`：前端“适配器工作台”读取的真实注册表状态。
- `data/recent-articles-*.json`：某个日期范围或某天的抓取工作流输出。
- `data/push-history.json`：前端累计推送历史，会按文章 ID 去重并保留最早首次发现日。
- `data/recent-front-data.js`：前端页面实际读取的文章推送数据，由累计推送历史生成。
- `data/search-tags.json`：主题检索规则，目前默认包含非洲主题关键词和学科标签。
- `data/topic-search-index.js`：前端主题检索读取的静态索引，由累计推送历史生成。
- `data/source-state.json`：每日自动运行时使用的去重和首次发现记录。
- `data/.pdf-cache/abstract-backfill/`：PDF 摘要回填缓存目录，已被 `.gitignore` 忽略。
- `scripts/build-adapter-front-data.mjs`：把 `data/adapter-profiles.json` 转换成前端适配器工作台数据。
- `scripts/article-link-policy.mjs`：控制哪些链接可以作为前端可点击论文链接；目录页、第三方发现页会保留为 `discovery_url`，等待官方 PDF/详情解析。
- `scripts/fetch-articles-smoke-test.mjs`：真实抓取入口，会访问 RSS、官网页面、替代目录页或开放元数据接口。
- `scripts/build-front-data.mjs`：把抓取结果转换成前端能展示的数据。
- `scripts/build-topic-search-index.mjs`：从 `data/push-history.json` 重建主题检索索引；如果只有生成时间变化，不会重写索引文件。
- `scripts/run-daily-workflow.mjs`：每日自动检查入口，只检查当天窗口并按首次发现去重；发现新推送后会触发当天新增文章的摘要回填。
- `scripts/run-daily-publish.mjs`：每日发布入口，先运行每日检查，再把当天生成的数据文件提交并推送到 GitHub，触发 Vercel 更新。
- `scripts/backfill-daily-abstracts.mjs`：每日摘要回填编排入口，只处理指定 `first_seen_at` 的新增文章。
- `scripts/backfill-ncpssd-abstracts.mjs`：直接用 NCPSD article API 补已有 NCPSD 详情页的摘要。
- `scripts/backfill-ncpssd-issue-abstracts.mjs`：按 NCPSD 期号页定位 `中国工业经济`、`会计研究` 等文章，再补摘要。
- `scripts/backfill-pdf-abstracts.mjs`：从 PDF 文本层或 OCR 提取摘要，主要用于 `经济研究` 和 `中国农村经济`。
- `scripts/backfill-english-metadata-abstracts.mjs`：用 Crossref/OpenAlex 等开放元数据补英文期刊摘要。
- `scripts/backfill-macrodatas-abstracts.mjs`：用 Macrodatas 期号页作为中文期刊摘要兜底。
- `scripts/install-daily-launchd.mjs`：安装或刷新 macOS 本机定时任务。

## 进一步文档

- [架构说明](docs/architecture.md)：数据流、数据源模型、日期模型和前端展示逻辑。
- [运行手册](docs/runbook.md)：日常运行、定时任务、检查命令和排障方法。
- [交接记录](docs/handoff.md)：当前项目状态、已完成内容和后续工作。

## 当前状态

截至 2026-07-10，本地已合入云端最新数据，并保留本地尚未上线的登录、角色、数据源共建和管理员信箱功能。

- 期刊数据源：22 个。
- 前端累计展示文章：574 篇，`data/recent-front-data.js` 和 `data/push-history.json` 均为 574 个唯一文章 ID。
- 已补摘要文章：452 篇；剩余 122 篇没有摘要，主要集中在 `中国工业经济`、`会计研究`、AMR 和 AER。
- 主题检索索引已按 574 篇累计历史重建；当前非洲主题命中 6 篇，语义分类未启用。
- 普通账号可使用内容工作流和提交数据源线索；管理员可查看数据源队列和草稿导入记录。任务及产物按 owner 隔离，管理员可跨 owner 处理。
- 数据源申请当前落为 `pending_auto_probe`；真实自动探测 runner 尚未实现。公众号草稿当前只保存 `prepared/mock` 导入记录，未调用微信 API。
- 每日自动任务的去重状态写入 `data/source-state.json`；摘要回填只补 `data/push-history.json` / `data/recent-front-data.js`，不改每日去重状态。
- `scripts/run-daily-workflow.mjs` 在新推送合并后自动运行 `scripts/backfill-daily-abstracts.mjs --first-seen-at=<date>`，尽量给当天新增文章补摘要；随后刷新 `data/topic-search-index.js`，让主题检索覆盖最新累计历史。
- `管理科学学报` 已可从新版期号页解析；旧版 reader 期号页可作为备用解析入口，2026-06-04 日常运行返回 11 篇当期文章。
- `中国行政管理` 先用维普目录发现当期条目，再用国家哲学社会科学文献中心期号页匹配到可点击的文章详情页；维普链接仅保留为 `discovery_url`。摘要回填优先走 NCPSD article API 慢队列。
- `中国工业经济` 和 `会计研究` 的官网详情页可能遇到访问验证或登录页；摘要回填优先尝试 NCPSD 期号页 + article API，未上架期次保留缺口。
- `中国农村经济` 官方 PDF 多为扫描件；摘要回填先尝试 PDF 文本层，失败后可用 `tesseract` + `poppler` OCR。
- `管理世界` 先用 Macrodatas 发现当期文章，再用国家哲学社会科学文献中心移动端期号页按标题匹配到官方单篇详情页；2026年第5期 11 篇已解析到 `Literature/articleinfo` 链接，官方页内再按权限提供阅读/下载入口。
- `南开管理评论` 先用 Macrodatas 发现当期文章，再按发现到的期号尝试国家哲学社会科学文献中心详情页升级；未解析到官方全文入口时保持 `needs_official_pdf`。

## 每日自动检查

生产环境现在由腾讯云服务器执行每日任务；本机 macOS LaunchAgent 已禁用并卸载，避免和服务器重复提交。

```text
服务器仓库：/opt/science-workshop/repo
服务器入口：/opt/science-workshop/run-daily-publish.sh
服务器定时：0 11 * * *
```

服务器入口会每天北京时间 11:00 运行：

```bash
node scripts/run-daily-publish.mjs
```

运行日志在：

- `/opt/science-workshop/logs/daily-publish.log`
- `/opt/science-workshop/logs/daily-publish.error.log`

本机备用 LaunchAgent 文件仍保留在：

```text
/Users/yuzhou4tc/Library/LaunchAgents/com.science-workshop.daily.plist
```

如果当天没有新文章，前端数据不会被空结果覆盖；如果发现新文章，脚本会先合并到 `data/push-history.json`，再更新 `data/recent-front-data.js`，随后只针对当天 `first_seen_at` 的新增文章运行摘要回填。摘要回填是增量增强步骤，单个来源超时或失败会记录在输出里，但不会阻塞主推送数据发布。每日流程结束前会刷新主题检索索引；发布入口只提交当天生成的数据文件、累计状态文件和发生实质变化的主题索引，推送到 `origin/main` 后由 Vercel 自动部署。页面默认展示累计推送历史，日期筛选只是缩小查看范围。
