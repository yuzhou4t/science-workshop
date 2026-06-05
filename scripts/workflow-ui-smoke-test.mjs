import fs from "node:fs";

const html = fs.readFileSync("index.html", "utf8");

const required = [
  "论文精读",
  "公众号文章写作",
  'data-workflow-panel="paper-reading"',
  'data-workflow-panel="wechat-writing"',
  "createPaperReadingJob",
  "createWechatWritingJob",
  "WORKFLOW_POLL_MAX_ATTEMPTS = 420",
  "/api/workflows/paper-reading/jobs",
  "/api/workflows/wechat-writing/jobs",
];

const missing = required.filter((item) => !html.includes(item));

if (missing.length > 0) {
  console.error(`Missing workflow UI markers: ${missing.join(", ")}`);
  process.exit(1);
}

console.log("workflow UI markers ok");
