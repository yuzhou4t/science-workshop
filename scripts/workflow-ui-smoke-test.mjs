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
  'data-view="source-contribution"',
  'data-page="source-contribution"',
  'data-view="sources" data-admin-only',
  'data-view="admin-inbox" data-admin-only',
  'data-view="adapters" data-admin-only',
  'data-page="sources" data-admin-only',
  'data-page="admin-inbox" data-admin-only',
  'data-page="adapters" data-admin-only',
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
  'id="sourceContributionForm"',
  'id="sourceRequestJournalName"',
  'id="sourceRequestIssn"',
  'id="sourceRequestHomepageUrl"',
  'id="sourceRequestArchiveUrl"',
  'id="sourceRequestSampleArticleUrl"',
  'id="sourceContributionStatus"',
  'id="sourceRequestRows"',
  'id="wechatDraftRows"',
  'id="refreshSourceRequests"',
  "当前先进入待探测队列",
  "提交后立即保存为 pending_auto_probe",
  "点击刷新信箱获取最新探测结果",
  "/api/source-requests",
  "createSourceRequest",
  "fetchSourceRequests",
  "attachSourceContribution",
  "loadSourceRequestLog",
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
  "批量导入",
  'id="wechatMaterials"',
  'name="materials"',
  'id="wechatWritingTitle"',
  'id="wechatDraftImport"',
  "生成模拟导入记录",
  "/api/wechat-drafts",
  "importWechatDraft",
  "fetchWechatDraftImports",
  "loadAdminInbox",
  "不会发送到微信",
  "splitWorkflowTitle",
  "composeWechatMarkdownForExport",
  "createPaperReadingJob",
  "createWechatWritingJob",
  "createIssueTocExportJob",
  'id="workshopLoginDialog"',
  'id="workshopLoginForm"',
  'id="workshopLoginRole"',
  'id="workshopAuthDock"',
  'id="openWorkshopLogin"',
  'id="workshopLogout"',
  "/api/auth/login",
  "/api/auth/logout",
  "logoutWorkshop",
  "ensureWorkshopAuthenticated",
  "applyWorkshopRoleVisibility",
  "isCurrentAdminInboxRequest",
  "revision: 0",
  "isWorkshopAdmin",
  "canAccessView",
  "管理员信箱",
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
  "选择期号或月份",
  "暂无可导出期号或月份",
  "issueTocGroupKey",
  "issueTocGroupLabel",
  "issueTocGroupIsMonthly",
  "月度新文",
  "从已爬取文章生成",
  "workflowDisplayError",
  "工作流后端",
  "uploadPaperReadingFile",
  "uploadPaperReadingFileToCos",
  "uploadWechatMaterialBlobToCos",
  "file_upload_id",
  'id="paperCosObjectKey" name="cos_object_key" type="hidden"',
  'id="wechatMaterialCosObjectKeys" name="material_cos_object_keys" type="hidden"',
  "cos_object_key",
  "material_cos_object_keys",
  "/api/workflows/paper-reading/cos-uploads",
  "/api/workflows/wechat-writing/cos-uploads",
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
  "tex-svg.js",
  "renderReadableFormula",
  "renderLatexFormula",
  "typesetWorkflowMath",
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
  '$$("[data-admin-only]").forEach',
  "adminInboxRefreshTimer",
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

const parseHttpUrlMatch = html.match(
  /const parseHttpUrl = \(value\) => \{([\s\S]*?)\n\s*\};\n\s*const validUrl/,
);
if (!parseHttpUrlMatch) {
  console.error("Unable to extract parseHttpUrl for executable checks");
  process.exit(1);
}

const parseHttpUrl = Function("value", parseHttpUrlMatch[1]);
for (const value of ["http:example.com", "http:///path", "ftp://example.com", "http://[", "http://example.com\\@evil.test", ""]) {
  if (parseHttpUrl(value) !== null) {
    console.error(`parseHttpUrl accepted malformed value: ${value}`);
    process.exit(1);
  }
}
if (parseHttpUrl("https://example.com/path")?.hostname !== "example.com") {
  console.error("parseHttpUrl rejected a valid HTTPS URL");
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
