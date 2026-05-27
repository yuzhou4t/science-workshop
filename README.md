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
node scripts/recent-workflow-test.mjs
node scripts/html-adapter-parsers-test.mjs
node scripts/date-enhancement-test.mjs
node scripts/launchd-plist-test.mjs
node scripts/adapter-smoke-test.mjs
```

手动跑一次指定日期范围的真实抓取，并把结果写入前端数据：

```bash
node scripts/fetch-articles-smoke-test.mjs --workflow --since=2026-04-27 --until=2026-05-27 --ignore-state
node scripts/build-front-data.mjs --workflow=data/recent-articles-2026-04-27_2026-05-27.json
```

## 主要文件

- `index.html`：前端原型页面，包含文章推送流、数据源汇总、筛选器和预留的转换功能入口。
- `data/adapter-profiles.json`：期刊数据源规则表，目前包含 5 个直接 RSS/eTOC 来源和 17 个页面适配来源。
- `data/fetch-smoke-results.json`：最近一次真实探测所有数据源后的结果。
- `data/recent-articles-*.json`：某个日期范围或某天的抓取工作流输出。
- `data/recent-front-data.js`：前端页面实际读取的文章推送数据。
- `data/source-state.json`：每日自动运行时使用的去重和首次发现记录。
- `scripts/fetch-articles-smoke-test.mjs`：真实抓取入口，会访问 RSS、官网页面、替代目录页或开放元数据接口。
- `scripts/build-front-data.mjs`：把抓取结果转换成前端能展示的数据。
- `scripts/run-daily-workflow.mjs`：每日自动检查入口，只检查当天窗口并按首次发现去重。
- `scripts/install-daily-launchd.mjs`：安装或刷新 macOS 本机定时任务。

## 进一步文档

- [架构说明](docs/architecture.md)：数据流、数据源模型、日期模型和前端展示逻辑。
- [运行手册](docs/runbook.md)：日常运行、定时任务、检查命令和排障方法。
- [交接记录](docs/handoff.md)：2026-05-27 的项目状态、已完成内容和后续工作。

## 当前状态

截至 2026-05-27，参考完整抓取结果为 `data/recent-articles-2026-04-27_2026-05-27.json`。

- 期刊数据源：22 个。
- 当前可用数据源：22 个。
- 日期窗口内文章：157 篇。
- 前端推送队列文章：191 篇。
- 只有期号日期、没有精确发表日的文章：24 篇。
- 暂时没有明确发表日期、但通过“首次发现日期”保护的候选文章：34 篇。
- 每日自动任务的基线状态已写入 `data/source-state.json`。

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

如果当天没有新文章，前端数据不会被空结果覆盖；如果发现新文章，脚本会更新 `data/recent-front-data.js`，页面里的推送流也会随之更新。
