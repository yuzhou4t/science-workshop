import { readdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { normalizeArticleLink } from "./article-link-policy.mjs";
import { compactArticleTitle } from "./official-link-resolvers.mjs";

const dataDir = new URL("../data/", import.meta.url);
const outputPath = new URL("../data/recent-front-data.js", import.meta.url);
const historyPath = new URL("../data/push-history.json", import.meta.url);

function cliFlag(name) {
  return process.argv.slice(2).includes(name);
}

function cliValue(name) {
  return process.argv.slice(2).find((arg) => arg.startsWith(`${name}=`))?.slice(name.length + 1);
}

async function readJsonIfExists(url, fallback) {
  try {
    return JSON.parse(await readFile(url, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return fallback;
    throw error;
  }
}

async function resolveWorkflowPath() {
  const argPath = cliValue("--workflow");
  if (argPath) return new URL(argPath, `file://${process.cwd()}/`);

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

function compactArticle(article) {
  const articleLink = normalizeArticleLink(article, article);
  return {
    id: article.id,
    journal_id: article.journal_id,
    source_journal_id: article.source_journal_id || article.journal_id,
    journal_name: article.journal_name,
    title: article.title,
    url: articleLink.url,
    official_url: articleLink.official_url,
    pdf_url: articleLink.pdf_url,
    discovery_url: articleLink.discovery_url,
    link_status: articleLink.link_status,
    link_note: articleLink.link_note,
    authors: article.authors || "",
    published_at: article.published_at || "",
    issue_date: article.issue_date || "",
    first_seen_at: article.first_seen_at || "",
    display_date: article.display_date || article.published_at || article.issue_date || article.first_seen_at || "",
    display_date_basis: article.display_date_basis || "",
    push_basis: article.push_basis || "",
    extraction_rule: article.extraction_rule || "",
    date_source: article.date_source || "",
  };
}

function minDate(a = "", b = "") {
  if (!a) return b;
  if (!b) return a;
  return a <= b ? a : b;
}

function normalizedHistoryUrl(value = "") {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try {
    const url = new URL(raw);
    url.hostname = url.hostname.toLowerCase();
    if (!/macrodatas\.cn$/i.test(url.hostname) || !url.hash.startsWith("#:~:text=")) url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
      if (/^utm_/i.test(key) || ["sign", "expireTime", "expires", "_t", "timestamp", "token"].includes(key)) {
        url.searchParams.delete(key);
      }
    }
    url.searchParams.sort();
    return url.toString().replace(/\/$/, "").toLowerCase();
  } catch {
    return raw.split("#")[0].replace(/\/$/, "").toLowerCase();
  }
}

function articleUrlHistoryKey(article) {
  const articleLink = normalizeArticleLink(article, article);
  const url = normalizedHistoryUrl(articleLink.url || articleLink.official_url || articleLink.discovery_url);
  return url ? `${article.journal_id || article.source_journal_id || ""}::url::${url}` : "";
}

function articleTitleHistoryKey(article) {
  const title = compactArticleTitle(article.title || "");
  if (!title) return "";
  return [
    article.journal_id || article.source_journal_id || "",
    "title",
    title,
    article.published_at || article.issue_date || article.display_date || "",
  ].join("::");
}

function mergeArticle(existing, incoming) {
  if (!existing) return incoming;
  const firstSeenAt = minDate(existing.first_seen_at, incoming.first_seen_at);
  const merged = {
    ...existing,
    ...incoming,
    id: existing.id || incoming.id,
    authors: incoming.authors || existing.authors || "",
    published_at: incoming.published_at || existing.published_at || "",
    issue_date: incoming.issue_date || existing.issue_date || "",
    first_seen_at: firstSeenAt,
    display_date: incoming.display_date || existing.display_date || firstSeenAt,
    display_date_basis: incoming.display_date_basis || existing.display_date_basis || "",
    push_basis: existing.push_basis || incoming.push_basis || "",
  };
  const existingResolved = ["official_pdf", "official_detail"].includes(existing.link_status) || existing.official_url || existing.pdf_url;
  const incomingResolved = ["official_pdf", "official_detail"].includes(incoming.link_status) || incoming.official_url || incoming.pdf_url;
  if (existingResolved && !incomingResolved) {
    return {
      ...merged,
      url: existing.url,
      official_url: existing.official_url,
      pdf_url: existing.pdf_url,
      discovery_url: incoming.discovery_url || existing.discovery_url || "",
      link_status: existing.link_status,
      link_note: existing.link_note,
    };
  }
  return merged;
}

function sortPushArticles(articles) {
  return [...articles].sort((a, b) => {
    const pushDateOrder = String(b.first_seen_at || "").localeCompare(String(a.first_seen_at || ""));
    if (pushDateOrder) return pushDateOrder;
    const articleDateOrder = String(b.published_at || b.issue_date || b.display_date || "").localeCompare(String(a.published_at || a.issue_date || a.display_date || ""));
    if (articleDateOrder) return articleDateOrder;
    return String(a.title || "").localeCompare(String(b.title || ""), "zh-Hans-CN");
  });
}

export function mergePushHistory(existingHistory = {}, workflow, options = {}) {
  const byKey = new Map();
  const aliasToKey = new Map();

  function upsertArticle(article) {
    if (!article?.id) return;
    const incoming = compactArticle(article);
    const aliases = [
      `id:${incoming.id}`,
      articleUrlHistoryKey(incoming),
      articleTitleHistoryKey(incoming),
    ].filter(Boolean);
    const key = aliases.map((alias) => aliasToKey.get(alias)).find(Boolean) || aliases[1] || aliases[2] || aliases[0];
    const merged = mergeArticle(byKey.get(key), incoming);
    byKey.set(key, merged);
    for (const alias of aliases) aliasToKey.set(alias, key);
    if (merged.id) aliasToKey.set(`id:${merged.id}`, key);
  }

  for (const article of existingHistory.articles || []) upsertArticle(article);
  for (const article of workflow.push_queue || []) {
    upsertArticle(article);
  }

  const articles = sortPushArticles([...byKey.values()]);
  const firstSeenDates = articles.map((article) => article.first_seen_at).filter(Boolean).sort();
  return {
    version: 1,
    updated_at: options.updatedAt || workflow.summary?.checked_at || new Date().toISOString(),
    summary: {
      checked_at: workflow.summary?.checked_at || "",
      since: firstSeenDates[0] || workflow.summary?.since || "",
      until: firstSeenDates.at(-1) || workflow.summary?.until || "",
      sources_total: workflow.summary?.sources_total || 0,
      sources_ready: workflow.summary?.sources_ready || 0,
      history_articles: articles.length,
      push_queue_articles: articles.length,
      new_push_queue_articles: workflow.summary?.push_queue_articles || 0,
      last_workflow_file: options.workflowFile || "",
    },
    articles,
  };
}

export function frontDataFromHistory(history) {
  const articles = sortPushArticles(history.articles || []);
  return {
    summary: {
      ...(history.summary || {}),
      push_queue_articles: articles.length,
    },
    push_queue: articles.map(compactArticle),
  };
}

async function main() {
  const workflowPath = await resolveWorkflowPath();
  const workflow = JSON.parse(await readFile(workflowPath, "utf8"));
  const existingHistory = cliFlag("--reset-history") ? { version: 1, articles: [] } : await readJsonIfExists(historyPath, { version: 1, articles: [] });
  const workflowFile = `data/${workflowPath.pathname.split("/").at(-1)}`;
  const history = mergePushHistory(existingHistory, workflow, { workflowFile });
  const frontData = frontDataFromHistory(history);

  await writeFile(historyPath, `${JSON.stringify(history, null, 2)}\n`, "utf8");
  await writeFile(outputPath, `window.RECENT_WORKFLOW_DATA = ${JSON.stringify(frontData, null, 2)};\n`, "utf8");
  console.log(`wrote ${outputPath.pathname} from ${historyPath.pathname} (${frontData.push_queue.length} articles)`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}
