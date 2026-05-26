import { readdir, readFile, writeFile } from "node:fs/promises";

async function resolveWorkflowPath() {
  const argPath = process.argv.slice(2).find((arg) => arg.startsWith("--workflow="))?.slice("--workflow=".length);
  if (argPath) return new URL(argPath, `file://${process.cwd()}/`);

  const dataDir = new URL("../data/", import.meta.url);
  const entries = await readdir(dataDir, { withFileTypes: true });
  const workflowFiles = entries
    .filter((entry) => entry.isFile() && /^recent-articles-\d{4}-\d{2}-\d{2}_\d{4}-\d{2}-\d{2}\.json$/.test(entry.name))
    .map((entry) => entry.name)
    .sort();

  for (const file of workflowFiles.toReversed()) {
    const workflowPath = new URL(`../data/${file}`, import.meta.url);
    const workflow = JSON.parse(await readFile(workflowPath, "utf8"));
    if (workflow.summary?.sources_ready > 0) return workflowPath;
  }

  throw new Error("No successful recent workflow file found under data/.");
}

const workflowPath = await resolveWorkflowPath();
const outputPath = new URL("../data/recent-front-data.js", import.meta.url);
const workflow = JSON.parse(await readFile(workflowPath, "utf8"));

const compactArticle = (article) => ({
  id: article.id,
  journal_id: article.journal_id,
  source_journal_id: article.source_journal_id || article.journal_id,
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
console.log(`wrote ${outputPath.pathname} from ${workflowPath.pathname}`);
