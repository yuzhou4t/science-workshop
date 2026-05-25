import { readFile, writeFile } from "node:fs/promises";

const workflowPath = new URL("../data/recent-articles-2026-04-25_2026-05-25.json", import.meta.url);
const outputPath = new URL("../data/recent-front-data.js", import.meta.url);
const workflow = JSON.parse(await readFile(workflowPath, "utf8"));

const compactArticle = (article) => ({
  id: article.id,
  journal_id: article.journal_id,
  journal_name: article.journal_name,
  title: article.title,
  url: article.url,
  authors: article.authors || "",
  published_at: article.published_at || "",
  issue_date: article.issue_date || "",
  first_seen_at: article.first_seen_at || "",
  display_date: article.display_date || article.published_at || article.issue_date || article.first_seen_at || "",
  display_date_basis: article.display_date_basis || "",
  push_basis: article.push_basis || "",
  extraction_rule: article.extraction_rule || "",
  date_source: article.date_source || "",
});

const frontData = {
  summary: workflow.summary,
  push_queue: workflow.push_queue.map(compactArticle),
};

const js = `window.RECENT_WORKFLOW_DATA = ${JSON.stringify(frontData, null, 2)};\n`;
await writeFile(outputPath, js);
console.log(`wrote ${outputPath.pathname}`);
