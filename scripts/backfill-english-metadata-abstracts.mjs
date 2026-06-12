import { readFile, writeFile } from "node:fs/promises";
import { setTimeout as sleep } from "node:timers/promises";

import {
  doiFromUrl,
  extractMetadataAbstractHints,
} from "./date-enhancement-lib.mjs";

const historyPath = new URL("../data/push-history.json", import.meta.url);

function cliValue(name) {
  return process.argv.slice(2).find((arg) => arg.startsWith(`${name}=`))?.slice(name.length + 1);
}

function cliFlag(name) {
  return process.argv.slice(2).includes(name);
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function normalizeTitle(value = "") {
  return String(value)
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function titleMatches(expected = "", actual = "") {
  const left = normalizeTitle(expected);
  const right = normalizeTitle(actual);
  if (!left || !right) return false;
  if (left === right) return true;
  if (left.length > 45 && right.length > 45 && (left.includes(right) || right.includes(left))) return true;
  return false;
}

function isEnglishJournal(article = {}) {
  return !/[\u3400-\u9fff]/.test(article.journal_name || "");
}

function selectedJournals() {
  return (cliValue("--journals") || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

function targetArticles(history) {
  const journals = selectedJournals();
  const journalSet = new Set(journals);
  const limit = Number(cliValue("--limit") || 0);
  const firstSeenAt = cliValue("--first-seen-at") || "";
  const articles = (history.articles || [])
    .filter((article) => isEnglishJournal(article))
    .filter((article) => !article.abstract)
    .filter((article) => !firstSeenAt || article.first_seen_at === firstSeenAt)
    .filter((article) => !journalSet.size || journalSet.has(article.journal_name));
  return limit > 0 ? articles.slice(0, limit) : articles;
}

async function fetchJson(url, timeoutMs, headers = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": "ScienceWorkshop/0.2 (metadata abstract backfill)",
        Accept: "application/json,*/*;q=0.8",
        ...headers,
      },
      signal: controller.signal,
    });
    const text = await response.text();
    if (!response.ok) return { ok: false, status: response.status, error: `status_${response.status}` };
    try {
      return { ok: true, status: response.status, data: JSON.parse(text) };
    } catch {
      return { ok: false, status: response.status, error: "json_parse_failed" };
    }
  } catch (error) {
    return { ok: false, status: 0, error: error.name === "AbortError" ? "timeout" : error.message };
  } finally {
    clearTimeout(timer);
  }
}

async function crossrefByDoi(article, timeoutMs) {
  const doi = doiFromUrl(article.url || article.official_url || "");
  if (!doi) return {};
  const url = `https://api.crossref.org/works/${encodeURIComponent(doi)}`;
  const response = await fetchJson(url, timeoutMs);
  if (!response.ok) return { source: "crossref", ok: false, error: response.error, status: response.status };
  const hints = extractMetadataAbstractHints(response.data);
  return { source: "crossref", ok: Boolean(hints.abstract), hints, status: response.status };
}

async function openAlexByDoi(article, timeoutMs) {
  const doi = doiFromUrl(article.url || article.official_url || "");
  if (!doi) return {};
  const url = `https://api.openalex.org/works/doi:${encodeURIComponent(`https://doi.org/${doi}`)}`;
  const response = await fetchJson(url, timeoutMs);
  if (!response.ok) return { source: "openalex-doi", ok: false, error: response.error, status: response.status };
  const hints = extractMetadataAbstractHints(response.data);
  return { source: "openalex-doi", ok: Boolean(hints.abstract), hints, status: response.status };
}

async function openAlexByTitle(article, timeoutMs) {
  const params = new URLSearchParams({
    search: article.title || "",
    "per-page": "5",
  });
  const url = `https://api.openalex.org/works?${params}`;
  const response = await fetchJson(url, timeoutMs);
  if (!response.ok) return { source: "openalex-title", ok: false, error: response.error, status: response.status };
  for (const work of response.data?.results || []) {
    if (!titleMatches(article.title, work.display_name || "")) continue;
    const hints = extractMetadataAbstractHints(work);
    if (hints.abstract) {
      return {
        source: "openalex-title",
        ok: true,
        hints,
        status: response.status,
        matched_title: work.display_name || "",
      };
    }
  }
  return { source: "openalex-title", ok: false, status: response.status, error: "no_strict_title_abstract" };
}

async function semanticScholarByDoi(article, timeoutMs) {
  const doi = doiFromUrl(article.url || article.official_url || "");
  if (!doi) return {};
  const url = `https://api.semanticscholar.org/graph/v1/paper/DOI:${encodeURIComponent(doi)}?fields=title,abstract`;
  const response = await fetchJson(url, timeoutMs);
  if (!response.ok) return { source: "semantic-scholar", ok: false, error: response.error, status: response.status };
  if (!titleMatches(article.title, response.data?.title || "")) {
    return { source: "semantic-scholar", ok: false, status: response.status, error: "title_mismatch" };
  }
  const abstract = String(response.data?.abstract || "").trim();
  return {
    source: "semantic-scholar",
    ok: Boolean(abstract),
    hints: abstract ? { abstract } : {},
    status: response.status,
  };
}

async function enrichArticle(article, options = {}) {
  const methods = [
    crossrefByDoi,
    openAlexByDoi,
    openAlexByTitle,
    ...(options.semanticScholar ? [semanticScholarByDoi] : []),
  ];
  const attempts = [];
  for (const method of methods) {
    const result = await method(article, options.timeoutMs);
    if (result.source) attempts.push(result);
    if (result.ok && result.hints?.abstract) {
      return {
        article: { ...article, abstract: result.hints.abstract },
        addedAbstract: true,
        source: result.source,
        matched_title: result.matched_title || "",
        attempts,
      };
    }
    await sleep(options.delayMs);
  }
  return { article, addedAbstract: false, source: "", attempts };
}

async function main() {
  const history = JSON.parse(await readFile(historyPath, "utf8"));
  const output = cliValue("--output") || `data/recent-articles-english-metadata-backfill-${today()}.json`;
  const options = {
    timeoutMs: Number(cliValue("--timeout-ms") || 15000),
    delayMs: Number(cliValue("--delay-ms") || 1000),
    semanticScholar: cliFlag("--semantic-scholar"),
  };
  const articles = targetArticles(history);
  const results = [];

  for (const article of articles) {
    const result = await enrichArticle(article, options);
    results.push(result);
    console.log(JSON.stringify({
      journal: article.journal_name,
      title: article.title.slice(0, 58),
      abstract: result.addedAbstract,
      source: result.source,
      last_error: result.attempts.at(-1)?.error || "",
    }));
    await sleep(options.delayMs);
  }

  const pushQueue = results.filter((result) => result.addedAbstract).map((result) => result.article);
  const workflow = {
    summary: {
      checked_at: new Date().toISOString(),
      since: "2000-01-01",
      until: today(),
      sources_total: history.summary?.sources_total || 22,
      sources_ready: history.summary?.sources_ready || 20,
      push_queue_articles: pushQueue.length,
      abstract_backfill: true,
      english_metadata_backfill: true,
      semantic_scholar: options.semanticScholar,
      backfill_sources: ["crossref-doi", "openalex-doi", "openalex-title", ...(options.semanticScholar ? ["semantic-scholar-doi"] : [])],
    },
    push_queue: pushQueue,
    results,
  };
  await writeFile(new URL(output, `file://${process.cwd()}/`), `${JSON.stringify(workflow, null, 2)}\n`, "utf8");
  console.log(`WROTE ${pushQueue.length}/${articles.length} ${output}`);
}

if (process.argv[1] && import.meta.url === new URL(process.argv[1], "file://").href) {
  await main();
}
