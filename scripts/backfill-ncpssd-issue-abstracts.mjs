import { readFile, writeFile } from "node:fs/promises";
import { setTimeout as sleep } from "node:timers/promises";

import { parseNcpssdIssueArticles } from "./official-link-resolvers.mjs";

const historyPath = new URL("../data/push-history.json", import.meta.url);

const DEFAULT_GCH = new Map([
  ["中国工业经济", "93800A"],
  ["会计研究", "96456X"],
]);

function cliValue(name) {
  return process.argv.slice(2).find((arg) => arg.startsWith(`${name}=`))?.slice(name.length + 1);
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function selectedJournals() {
  return (cliValue("--journals") || [...DEFAULT_GCH.keys()].join(","))
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

function gchForJournal(journal) {
  const overrides = (cliValue("--gch") || "")
    .split(",")
    .map((pair) => pair.split(":").map((part) => part.trim()))
    .filter((pair) => pair.length === 2);
  const override = overrides.find(([name]) => name === journal)?.[1];
  return override || DEFAULT_GCH.get(journal) || "";
}

function stripTags(value = "") {
  return String(value)
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function compactText(value = "") {
  return stripTags(value)
    .normalize("NFKC")
    .replace(/[：﹕]/g, ":")
    .replace(/[‐‑‒–—]/g, "-")
    .replace(/\s+/g, "")
    .trim();
}

function titleMatches(left = "", right = "") {
  const a = compactText(left);
  const b = compactText(right);
  if (!a || !b) return false;
  if (a === b) return true;
  const truncated = a.match(/^(.+?)(?:\.{2,}|…+)$/)?.[1] || "";
  return truncated.length >= 12 && b.startsWith(truncated);
}

function splitKeywords(value = "") {
  const seen = new Set();
  const keywords = [];
  for (const raw of stripTags(value).split(/[;；,，、]+/)) {
    const keyword = raw.trim();
    const key = keyword.toLowerCase();
    if (!keyword || seen.has(key)) continue;
    seen.add(key);
    keywords.push(keyword);
  }
  return keywords;
}

function issueParts(issueDate = "") {
  const match = String(issueDate).match(/^(20\d{2})-(\d{1,2})$/);
  return match ? { year: match[1], issue: String(Number(match[2])) } : {};
}

function targetArticles(history) {
  const journalSet = new Set(selectedJournals());
  const firstSeenAt = cliValue("--first-seen-at") || "";
  return (history.articles || [])
    .filter((article) => journalSet.has(article.journal_name))
    .filter((article) => !article.abstract)
    .filter((article) => !firstSeenAt || article.first_seen_at === firstSeenAt)
    .filter((article) => article.issue_date);
}

async function fetchText(url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 ScienceWorkshop/0.2",
        Accept: "text/html,application/xhtml+xml,*/*;q=0.8",
      },
      signal: controller.signal,
    });
    return { ok: response.ok, status: response.status, url: response.url, text: await response.text() };
  } catch (error) {
    return { ok: false, status: 0, url, text: "", error: error.name === "AbortError" ? "timeout" : error.message };
  } finally {
    clearTimeout(timer);
  }
}

async function postNcpssdArticle(candidate, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch("https://www.ncpssd.org/articleinfoHandler/getjournalarticletable", {
      method: "POST",
      headers: {
        "User-Agent": "Mozilla/5.0 ScienceWorkshop/0.2",
        Accept: "application/json, text/javascript, */*; q=0.01",
        "Content-Type": "application/json; charset=utf-8",
        "X-Requested-With": "XMLHttpRequest",
        Referer: candidate.official_url || "https://m.ncpssd.cn/",
      },
      body: JSON.stringify({ lngid: candidate.id, type: "中文期刊文章", pageType: 1 }),
      signal: controller.signal,
    });
    const text = await response.text();
    try {
      return { ok: response.ok, status: response.status, data: JSON.parse(text)?.data || {} };
    } catch {
      return { ok: false, status: response.status, error: "json_parse_failed" };
    }
  } catch (error) {
    return { ok: false, status: 0, error: error.name === "AbortError" ? "timeout" : error.message };
  } finally {
    clearTimeout(timer);
  }
}

function patchFromNcpssd(article, candidate, data = {}) {
  const abstract = stripTags(data.remarkc || data.remark || "");
  const keywords = splitKeywords(data.keywordc || data.keyword || "");
  return {
    ...article,
    abstract: abstract && abstract !== "暂无" ? abstract : article.abstract || "",
    keywords: keywords.length ? keywords : article.keywords || [],
    reader_url: article.reader_url || candidate.reader_url || "",
    official_source: article.official_source || "ncpssd",
  };
}

async function fetchIssueCandidates(journal, issueDate, timeoutMs) {
  const gch = gchForJournal(journal);
  const parts = issueParts(issueDate);
  if (!gch || !parts.year || !parts.issue) return { candidates: [], issue_url: "", status: 0, error: "missing_gch_or_issue" };
  const issueUrl = `https://m.ncpssd.cn/journal/details?gch=${encodeURIComponent(gch)}&langType=1&nav=1&years=${parts.year}&num=${parts.issue}`;
  const response = await fetchText(issueUrl, timeoutMs);
  if (!response.ok) return { candidates: [], issue_url: issueUrl, status: response.status, error: response.error || "" };
  return {
    candidates: parseNcpssdIssueArticles(response.text, response.url),
    issue_url: response.url,
    status: response.status,
    error: "",
  };
}

async function retry(operation, options = {}) {
  let last;
  for (let attempt = 1; attempt <= options.retries; attempt += 1) {
    last = await operation();
    if (last?.ok || last?.candidates?.length) return { ...last, attempt };
    await sleep(options.delayMs * attempt);
  }
  return { ...last, attempt: options.retries };
}

async function main() {
  const output = cliValue("--output") || `data/recent-articles-ncpssd-issue-backfill-${today()}.json`;
  const history = JSON.parse(await readFile(historyPath, "utf8"));
  const articles = targetArticles(history);
  const timeoutMs = Number(cliValue("--timeout-ms") || 20000);
  const delayMs = Number(cliValue("--delay-ms") || 5000);
  const retries = Number(cliValue("--retries") || 2);

  const issueCache = new Map();
  const results = [];
  for (const article of articles) {
    const issueKey = `${article.journal_name}::${article.issue_date}`;
    if (!issueCache.has(issueKey)) {
      issueCache.set(issueKey, await retry(
        () => fetchIssueCandidates(article.journal_name, article.issue_date, timeoutMs),
        { retries, delayMs },
      ));
      await sleep(delayMs);
    }
    const issue = issueCache.get(issueKey);
    const candidate = issue.candidates.find((item) => titleMatches(article.title, item.title));
    if (!candidate) {
      results.push({
        article,
        addedAbstract: false,
        response: { status: issue.status, error: issue.error || "title_not_found", issue_url: issue.issue_url, candidates: issue.candidates.length },
      });
      continue;
    }

    const response = await retry(
      () => postNcpssdArticle(candidate, timeoutMs),
      { retries, delayMs },
    );
    const patched = response.ok ? patchFromNcpssd(article, candidate, response.data) : article;
    results.push({
      article: patched,
      addedAbstract: Boolean(patched.abstract),
      keywords: patched.keywords?.length || 0,
      response: { status: response.status, attempt: response.attempt, error: response.error || "", issue_url: issue.issue_url, ncpssd_id: candidate.id },
    });
    console.log(JSON.stringify({
      journal: article.journal_name,
      title: article.title.slice(0, 40),
      abstract: Boolean(patched.abstract),
      keywords: patched.keywords?.length || 0,
      status: response.status,
      error: response.error || "",
    }));
    await sleep(delayMs);
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
      ncpssd_issue_backfill: true,
      backfill_sources: ["ncpssd-mobile-issue", "ncpssd-article-api"],
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
