import fs from "node:fs";

const html = fs.readFileSync("index.html", "utf8");

const required = [
  "论文精读",
  "公众号文章写作",
  'data-view="paper-reading"',
  'data-view="wechat-writing"',
  'data-page="paper-reading"',
  'data-page="wechat-writing"',
  'data-workflow-panel="paper-reading"',
  'data-workflow-panel="wechat-writing"',
  "createPaperReadingJob",
  "createWechatWritingJob",
  "WORKFLOW_POLL_MAX_ATTEMPTS = 420",
  "/api/workflows/paper-reading/jobs",
  "/api/workflows/wechat-writing/jobs",
];

const missing = required.filter((item) => !html.includes(item));
const forbidden = [
  'data-view="workflows"',
  'data-page="workflows"',
  'data-view="reserved"',
  "公众号转换",
  "选题重写",
  "推送设置",
  "任务监控",
].filter((item) => html.includes(item));

if (missing.length > 0) {
  console.error(`Missing workflow UI markers: ${missing.join(", ")}`);
  process.exit(1);
}

if (forbidden.length > 0) {
  console.error(`Found stale workflow placeholders: ${forbidden.join(", ")}`);
  process.exit(1);
}

const sidebarViews = [...html.matchAll(/class="side-link[^"]*"\s+data-view="([^"]+)"/g)].map((match) => match[1]);
const pageViews = new Set([...html.matchAll(/data-page="([^"]+)"/g)].map((match) => match[1]));
const missingPages = sidebarViews.filter((view) => !pageViews.has(view));

if (missingPages.length > 0) {
  console.error(`Sidebar views without matching pages: ${missingPages.join(", ")}`);
  process.exit(1);
}

console.log("workflow UI markers ok");
