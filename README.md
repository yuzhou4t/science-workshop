# Science Workshop

这是一个用于“期刊追踪工作坊”的本地原型项目。它包含一个可直接打开的前端页面，以及一套本地运行的期刊文章抓取流程，用来持续观察目标期刊是否有新文章发布。

这个项目目前适合做三件事：

- 展示近一段时间抓到的期刊文章推送流。
- 管理期刊官网、过刊页、样例文章、RSS 或替代数据源。
- 在本机每天自动检查一次新文章，为后续公众号文章转换功能做准备。

## 快速开始

直接打开前端原型：

```bash
open index.html
```

运行不依赖外网的基础检查：

```bash
node scripts/adapter-fallback-test.mjs
node scripts/fetch-retry-policy-test.mjs
node scripts/article-link-policy-test.mjs
node scripts/official-link-resolvers-test.mjs
node scripts/recent-workflow-test.mjs
node scripts/front-data-history-test.mjs
node scripts/html-adapter-parsers-test.mjs
node scripts/date-enhancement-test.mjs
node scripts/launchd-plist-test.mjs
node scripts/adapter-smoke-test.mjs
```

手动跑一次指定日期范围的真实抓取，并把结果写入前端数据：

```bash
node scripts/fetch-articles-smoke-test.mjs --workflow --since=2026-04-27 --until=2026-05-27 --ignore-state
node scripts/build-front-data.mjs --reset-history --workflow=data/recent-articles-2026-04-27_2026-05-27.json
```

## 主要文件

- `index.html`：前端原型页面，包含文章推送流、数据源汇总、筛选器和预留的转换功能入口。
- `data/adapter-profiles.json`：期刊数据源规则表，目前包含 5 个直接 RSS/eTOC 来源和 17 个页面适配来源。
- `data/fetch-smoke-results.json`：最近一次真实探测所有数据源后的结果。
- `data/adapter-front-data.js`：前端“适配器工作台”读取的真实注册表状态。
- `data/recent-articles-*.json`：某个日期范围或某天的抓取工作流输出。
- `data/push-history.json`：前端累计推送历史，会按文章 ID 去重并保留最早首次发现日。
- `data/recent-front-data.js`：前端页面实际读取的文章推送数据，由累计推送历史生成。
- `data/source-state.json`：每日自动运行时使用的去重和首次发现记录。
- `scripts/build-adapter-front-data.mjs`：把 `data/adapter-profiles.json` 转换成前端适配器工作台数据。
- `scripts/article-link-policy.mjs`：控制哪些链接可以作为前端可点击论文链接；目录页、第三方发现页会保留为 `discovery_url`，等待官方 PDF/详情解析。
- `scripts/fetch-articles-smoke-test.mjs`：真实抓取入口，会访问 RSS、官网页面、替代目录页或开放元数据接口。
- `scripts/build-front-data.mjs`：把抓取结果转换成前端能展示的数据。
- `scripts/run-daily-workflow.mjs`：每日自动检查入口，只检查当天窗口并按首次发现去重。
- `scripts/install-daily-launchd.mjs`：安装或刷新 macOS 本机定时任务。

## 进一步文档

- [架构说明](docs/architecture.md)：数据流、数据源模型、日期模型和前端展示逻辑。
- [运行手册](docs/runbook.md)：日常运行、定时任务、检查命令和排障方法。
- [交接记录](docs/handoff.md)：2026-05-27 的项目状态、已完成内容和后续工作。

## 当前状态

截至 2026-05-29，前端参考数据已合并到 `data/recent-articles-2026-05-29_2026-05-29.json`，并保留累计推送历史。

- 期刊数据源：22 个。
- 最近一次真实探测可用数据源：22 个。
- 前端累计展示文章：244 篇。
- 其中 28 篇目前只完成发现，仍待解析官方 PDF/详情链接；前端不会再把目录页或第三方目录页当成可点击论文链接。
- 今日新增推送文章：33 篇。
- 每日自动任务的去重状态已写入 `data/source-state.json`。
- `管理科学学报` 已可从新版期号页解析；旧版 reader 期号页可作为备用解析入口，单源探测可返回 10 篇当期文章。
- `中国行政管理` 先用维普目录发现当期条目，再用国家哲学社会科学文献中心期号页匹配到可点击的文章详情页；维普链接仅保留为 `discovery_url`。
- `管理世界` 和 `南开管理评论` 目前先用 Macrodatas 发现当期文章，再按发现到的期号尝试国家哲学社会科学文献中心详情页升级；截至 2026-05-29，目标期号在文献中心仍未返回文章候选，所以仍保持 `needs_official_pdf`。

## 每日自动检查

本机已经安装 macOS 定时任务：

```text
/Users/yuzhou4tc/Library/LaunchAgents/com.science-workshop.daily.plist
```

它会每天本地时间 10:00 运行：

```bash
node scripts/run-daily-workflow.mjs
```

运行日志在：

- `logs/daily-workflow.log`
- `logs/daily-workflow.error.log`

如果当天没有新文章，前端数据不会被空结果覆盖；如果发现新文章，脚本会先合并到 `data/push-history.json`，再更新 `data/recent-front-data.js`。页面默认展示累计推送历史，日期筛选只是缩小查看范围。
