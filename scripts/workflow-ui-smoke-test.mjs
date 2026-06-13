import fs from "node:fs";

const html = fs.readFileSync("index.html", "utf8");

const required = [
  "论文精读",
  "公众号文章写作",
  "期刊目录导出",
  'data-view="paper-reading"',
  'data-view="wechat-writing"',
  'data-view="issue-toc-export"',
  'data-view="topic-search"',
  'data-page="paper-reading"',
  'data-page="wechat-writing"',
  'data-page="issue-toc-export"',
  'data-page="topic-search"',
  'data-workflow-panel="paper-reading"',
  'data-workflow-panel="wechat-writing"',
  'data-workflow-panel="issue-toc-export"',
  'data-workflow-stage="paper-reading"',
  'data-workflow-stage="wechat-writing"',
  'data-workflow-stage="issue-toc-export"',
  'data-workflow-chain-rail="paper-reading"',
  'data-workflow-chain-rail="wechat-writing"',
  'data-workflow-chain-rail="issue-toc-export"',
  'data-workflow-chain="paper-reading"',
  'data-workflow-chain="wechat-writing"',
  'data-workflow-chain="issue-toc-export"',
  'id="statusDock"',
  'data-article-compose',
  'data-topic-abstract',
  "显示摘要",
  'data-article-abstract-close',
  'id="abstractModal"',
  "abstract-popover",
  "--abstract-height",
  "620",
  "420",
  "abstract-modal-open",
  "activeAbstractArticleId",
  "timeline-abstract-inline",
  "highlightSearchTerm",
  "search-highlight",
  "暂无摘要",
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
  "createIssueTocExportJob",
  'id="workshopLoginDialog"',
  'id="workshopLoginForm"',
  "/api/auth/login",
  "ensureWorkshopAuthenticated",
  'id="topicSearch"',
  'id="topicSearchInput"',
  'id="topicSearchClear"',
  'id="topicSearchResults"',
  'data-topic-search',
  'data-topic-search-discipline',
  "主题检索",
  "全库检索结果",
  "专题标签只作为命中说明",
  "非洲",
  "普通搜索命中",
  "命中依据",
  "window.TOPIC_SEARCH_INDEX",
  "buildIssueTocPayloadFromSelection",
  'id="issueTocJournalSelect"',
  'id="issueTocIssueSelect"',
  "暂无可导出期号",
  "从已爬取文章生成",
  "workflowDisplayError",
  "工作流后端",
  "uploadPaperReadingFile",
  "file_upload_id",
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
  "/api/workflows/paper-reading/file-uploads",
  "/api/workflows/wechat-writing/jobs",
  "/api/workflows/issue-toc-export/jobs",
];

const missing = required.filter((item) => !html.includes(item));
const forbidden = [
  'data-view="workflows"',
  'data-page="workflows"',
  'data-view="reserved"',
  'id="issueTocJson"',
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

for (const workflow of ["paper-reading", "wechat-writing", "issue-toc-export"]) {
  const railPattern = new RegExp(
    `<aside[^>]+data-workflow-chain-rail="${workflow}"[\\s\\S]*?<ol class="workflow-chain" data-workflow-chain="${workflow}"`,
  );
  if (!railPattern.test(html)) {
    console.error(`Workflow chain must live in right rail: ${workflow}`);
    process.exit(1);
  }
}

console.log("workflow UI markers ok");
