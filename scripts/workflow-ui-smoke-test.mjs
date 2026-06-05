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
  'data-workflow-stage="paper-reading"',
  'data-workflow-stage="wechat-writing"',
  'data-workflow-chain-rail="paper-reading"',
  'data-workflow-chain-rail="wechat-writing"',
  'data-workflow-chain="paper-reading"',
  'data-workflow-chain="wechat-writing"',
  'id="statusDock"',
  'data-article-compose',
  "seedWechatFromArticle",
  "updateWorkflowProgress",
  "is-running",
  "composeTransfer",
  "--rail-scale",
  "workflow-sheen",
  "workflow-evidence",
  "breath-surface",
  "预留接口",
  'id="wechatMaterials"',
  'name="materials"',
  'id="wechatWritingTitle"',
  "splitWorkflowTitle",
  "composeWechatMarkdownForExport",
  "createPaperReadingJob",
  "createWechatWritingJob",
  "workflowDisplayError",
  "本地工作流后端",
  "WORKFLOW_POLL_MAX_ATTEMPTS = 420",
  "WORKFLOW_NODE_STEPS",
  "workflowStepDetails",
  "subscribeWorkflowEvents",
  "workflowNodeDetailFromJob",
  "formatWorkflowElapsed",
  "EventSource",
  "MinerU 正在解析第",
  "workflow-preview",
  "workflow-editor-toolbar",
  "renderMarkdownPreview",
  "bindWorkflowEditorPreview",
  "setWorkflowEditorContent",
  "renderReadableFormula",
  "markdown-formula",
  "markdown-formula-block",
  "预览",
  "编辑",
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

for (const workflow of ["paper-reading", "wechat-writing"]) {
  const railPattern = new RegExp(
    `<aside[^>]+data-workflow-chain-rail="${workflow}"[\\s\\S]*?<ol class="workflow-chain" data-workflow-chain="${workflow}"`,
  );
  if (!railPattern.test(html)) {
    console.error(`Workflow chain must live in right rail: ${workflow}`);
    process.exit(1);
  }
}

console.log("workflow UI markers ok");
