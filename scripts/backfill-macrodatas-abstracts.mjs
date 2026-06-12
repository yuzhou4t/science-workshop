import { readFile, writeFile } from "node:fs/promises";
import { setTimeout as sleep } from "node:timers/promises";

import { parseMacrodatasIssuePageArticles } from "./html-adapter-parsers.mjs";

const historyPath = new URL("../data/push-history.json", import.meta.url);

function cliValue(name) {
  return process.argv.slice(2).find((arg) => arg.startsWith(`${name}=`))?.slice(name.length + 1);
}

function today() {
  return new Date().toISOString().slice(0, 10);
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

function parseAnchors(html = "", baseUrl = "") {
  const anchors = [];
  for (const match of String(html).matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    const href = match[1].match(/\bhref=(["'])([\s\S]*?)\1/i)?.[2] || "";
    if (!href) continue;
    try {
      anchors.push({ title: stripTags(match[2]), url: new URL(href, baseUrl).toString() });
    } catch {
      // Ignore malformed discovery links.
    }
  }
  return anchors;
}

function issuePartsFromTitle(value = "") {
  const match = String(value).match(/(20\d{2})\s*年\s*第?\s*(\d{1,2})\s*期/);
  return match ? { year: match[1], issue: String(Number(match[2])) } : {};
}

function issueDateFromParts(parts = {}) {
  return parts.year && parts.issue ? `${parts.year}-${String(parts.issue).padStart(2, "0")}` : "";
}

function issueSortKey(value = "") {
  const parts = issuePartsFromTitle(value);
  return parts.year && parts.issue ? Number(`${parts.year}${String(parts.issue).padStart(2, "0")}`) : 0;
}

function selectedJournals() {
  return (cliValue("--journals") || "中国工业经济,会计研究")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

function targetArticles(history) {
  const journals = new Set(selectedJournals());
  const firstSeenAt = cliValue("--first-seen-at") || "";
  return (history.articles || [])
    .filter((article) => journals.has(article.journal_name))
    .filter((article) => !article.abstract)
    .filter((article) => !firstSeenAt || article.first_seen_at === firstSeenAt);
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

async function discoverIssueLinks(journal, year, options = {}) {
  const listBaseUrl = cliValue("--list-base-url") || "https://www.macrodatas.cn/list/1/0/0/";
  const term = `${journal} ${year}年第`;
  const url = `${listBaseUrl}${encodeURIComponent(term)}`;
  const response = await fetchText(url, options.timeoutMs);
  if (!response.ok) return { response, links: [] };
  const exactJournal = `《${journal}》`;
  const links = parseAnchors(response.text, response.url)
    .filter((anchor) => /\/article\/\d+/i.test(anchor.url))
    .filter((anchor) => compactText(anchor.title).includes(compactText(exactJournal)))
    .map((anchor) => ({ ...anchor, issue_key: issueSortKey(anchor.title), issue_date: issueDateFromParts(issuePartsFromTitle(anchor.title)) }))
    .filter((anchor) => anchor.issue_key)
    .sort((a, b) => b.issue_key - a.issue_key);
  return { response, links };
}

async function backfillJournal(journal, articles, options = {}) {
  const neededIssues = new Set(articles.map((article) => article.issue_date).filter(Boolean));
  const years = new Set([...neededIssues].map((issueDate) => issueDate.slice(0, 4)).filter(Boolean));
  if (!years.size) years.add(String(new Date().getFullYear()));

  const articleByTitle = new Map(articles.map((article) => [compactText(article.title), article]));
  const results = [];
  const seenIssueUrls = new Set();

  for (const year of years) {
    const discovery = await discoverIssueLinks(journal, year, options);
    results.push({
      journal,
      discovery_url: discovery.response.url,
      discovery_status: discovery.response.status,
      discovered_issues: discovery.links.length,
      discovered_issue_titles: discovery.links.slice(0, 8).map((link) => link.title),
      addedAbstract: false,
    });
    const links = discovery.links.filter((link) => !neededIssues.size || neededIssues.has(link.issue_date));
    for (const link of links) {
      if (seenIssueUrls.has(link.url)) continue;
      seenIssueUrls.add(link.url);
      const response = await fetchText(link.url, options.timeoutMs);
      const parsed = response.ok ? parseMacrodatasIssuePageArticles(response.text, response.url) : [];
      for (const detail of parsed) {
        const article = articleByTitle.get(compactText(detail.title));
        if (!article || !detail.abstract) continue;
        const patched = {
          ...article,
          abstract: detail.abstract,
          keywords: detail.keywords?.length ? detail.keywords : article.keywords || [],
          discovery_url: article.discovery_url || link.url,
        };
        results.push({
          journal,
          issue_url: link.url,
          article: patched,
          addedAbstract: true,
          keywords: patched.keywords?.length || 0,
        });
      }
      await sleep(options.delayMs);
    }
    await sleep(options.delayMs);
  }
  return results;
}

async function main() {
  const output = cliValue("--output") || `data/recent-articles-macrodatas-abstract-backfill-${today()}.json`;
  const history = JSON.parse(await readFile(historyPath, "utf8"));
  const articles = targetArticles(history);
  const options = {
    timeoutMs: Number(cliValue("--timeout-ms") || 15000),
    delayMs: Number(cliValue("--delay-ms") || 1200),
  };

  const byJournal = new Map();
  for (const article of articles) {
    const list = byJournal.get(article.journal_name) || [];
    list.push(article);
    byJournal.set(article.journal_name, list);
  }

  const results = [];
  for (const [journal, journalArticles] of byJournal) {
    const journalResults = await backfillJournal(journal, journalArticles, options);
    results.push(...journalResults);
    const count = journalResults.filter((result) => result.addedAbstract).length;
    console.log(JSON.stringify({ journal, abstract: count, total: journalArticles.length }));
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
      macrodatas_abstract_backfill: true,
      backfill_sources: ["macrodatas-issue-page"],
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
