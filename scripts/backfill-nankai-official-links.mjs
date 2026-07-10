import { execFile } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { promisify } from "node:util";

import {
  parseNcpssdIssueArticles,
  resolveNankaiHistoricalOfficialArticle,
} from "./official-link-resolvers.mjs";

const historyPath = new URL("../data/push-history.json", import.meta.url);
const NANKAI_GCH = "81584X";
const execFileAsync = promisify(execFile);

function cliValue(name) {
  return process.argv.slice(2).find((arg) => arg.startsWith(`${name}=`))?.slice(name.length + 1);
}

function cliFlag(name) {
  return process.argv.slice(2).includes(name);
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function issueParts(issueDate = "") {
  const match = String(issueDate).match(/^(20\d{2})-(\d{1,2})$/);
  return match ? { year: match[1], issue: String(Number(match[2])) } : {};
}

function issueDatesForArticle(article) {
  const known = issueParts(article.issue_date);
  if (known.year && known.issue) return [article.issue_date];
  const year = String(article.first_seen_at || "").slice(0, 4);
  if (!/^20\d{2}$/.test(year)) return [];
  // Nankai Management Review publishes numbered issues; enumerate the
  // complete calendar year and only accept a title-level match from NCPSD.
  return Array.from({ length: 12 }, (_, index) => `${year}-${String(index + 1).padStart(2, "0")}`);
}

function historicalIssueDatesForArticle(article) {
  const known = issueParts(article.issue_date);
  if (!known.year || !known.issue) return [];
  const years = [Number(known.year), Number(known.year) - 1];
  return years.flatMap((year) => Array.from({ length: 6 }, (_, index) => `${year}-${String(index + 1).padStart(2, "0")}`))
    .filter((issueDate) => issueDate !== article.issue_date);
}

function issueUrl(issueDate) {
  const { year, issue } = issueParts(issueDate);
  if (!year || !issue) return "";
  return `https://m.ncpssd.cn/journal/details?gch=${NANKAI_GCH}&langType=1&nav=1&years=${year}&num=${issue}`;
}

function compactText(value = "") {
  return String(value)
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .normalize("NFKC")
    .replace(/[：﹕]/g, ":")
    .replace(/[‐‑‒–—]/g, "-")
    .replace(/\s+/g, "")
    .trim();
}

function parseNbrAnchors(html = "", baseUrl = "") {
  const candidates = [];
  for (const match of String(html).matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    const attrs = match[1] || "";
    const href = attrs.match(/\bhref=(['"])([\s\S]*?)\1/i)?.[2] || "";
    const title = attrs.match(/\btitle=(['"])([\s\S]*?)\1/i)?.[2]
      || match[2].replace(/<[^>]+>/g, " ");
    if (!href || !title.trim()) continue;
    try {
      const url = new URL(href, baseUrl).toString();
      if (new URL(url).hostname.toLowerCase() !== "nbr.nankai.edu.cn") continue;
      candidates.push({ title, official_url: url, url });
    } catch {
      // Ignore malformed or off-domain links.
    }
  }
  return candidates;
}

async function fetchText(url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      redirect: "follow",
      headers: {
        "User-Agent": "Mozilla/5.0 ScienceWorkshop/0.2 (historical link backfill)",
        Accept: "text/html,application/xhtml+xml,*/*;q=0.8",
      },
      signal: controller.signal,
    });
    const text = await response.text();
    return {
      ok: response.ok,
      status: response.status,
      url: response.url || url,
      text,
      error: response.ok ? "" : `status_${response.status}`,
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      url,
      text: "",
      error: error.name === "AbortError" ? "timeout" : error.message,
    };
  } finally {
    clearTimeout(timer);
  }
}

function unresolvedNankaiArticles(history) {
  return (history.articles || [])
    .filter((article) => article.journal_name === "南开管理评论")
    .filter((article) => !article.official_url && !article.pdf_url);
}

function nbrUrlsForArticle(article) {
  const configured = (cliValue("--nbr-url") || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const fromArticle = [article.nbr_url, article.nbr_archive_url, article.archive_url, article.url]
    .filter(Boolean)
    .filter((value) => {
      try {
        return new URL(value).hostname.toLowerCase() === "nbr.nankai.edu.cn";
      } catch {
        return false;
      }
    });
  const urls = [...configured, ...fromArticle];
  if (!urls.length) urls.push("https://nbr.nankai.edu.cn/nkglpl/home");
  return [...new Set(urls)];
}

async function main() {
  const history = JSON.parse(await readFile(historyPath, "utf8"));
  const output = cliValue("--output") || `data/recent-articles-nankai-official-links-${today()}.json`;
  const timeoutMs = Number(cliValue("--timeout-ms") || 20000);
  const targets = cliFlag("--all")
    ? (history.articles || []).filter((article) => article.journal_name === "南开管理评论")
    : unresolvedNankaiArticles(history);
  const issueCache = new Map();
  const nbrCache = new Map();
  const results = [];

  async function issueCandidates(issueDate) {
    if (issueCache.has(issueDate)) return issueCache.get(issueDate);
    const url = issueUrl(issueDate);
    const response = url ? await fetchText(url, timeoutMs) : { ok: false, status: 0, url, text: "", error: "invalid_issue_date" };
    const value = {
      issue_date: issueDate,
      issue_url: response.url || url,
      status: response.status,
      error: response.error || "",
      candidates: response.ok ? parseNcpssdIssueArticles(response.text, response.url || url) : [],
    };
    issueCache.set(issueDate, value);
    return value;
  }

  async function nbrCandidates(url) {
    if (nbrCache.has(url)) return nbrCache.get(url);
    const response = await fetchText(url, timeoutMs);
    const value = {
      nbr_url: response.url || url,
      status: response.status,
      error: response.error || "",
      candidates: response.ok ? parseNbrAnchors(response.text, response.url || url) : [],
    };
    nbrCache.set(url, value);
    return value;
  }

  for (const article of targets) {
    let patched = null;
    const evidence = [];
    const primaryIssueDates = issueDatesForArticle(article);
    for (const issueDate of primaryIssueDates) {
      const issue = await issueCandidates(issueDate);
      evidence.push({ source: "ncpssd", issue_date: issueDate, issue_url: issue.issue_url, status: issue.status, candidates: issue.candidates.length, error: issue.error });
      const resolved = resolveNankaiHistoricalOfficialArticle(article, issue.candidates);
      if (resolved) {
        patched = { ...resolved, issue_date: article.issue_date || issueDate, matched_issue_date: issueDate, date_source: article.date_source || "ncpssd_issue_title_match" };
        break;
      }
    }

    if (!patched) {
      for (const issueDate of historicalIssueDatesForArticle(article)) {
        const issue = await issueCandidates(issueDate);
        evidence.push({ source: "ncpssd_historical_scan", issue_date: issueDate, issue_url: issue.issue_url, status: issue.status, candidates: issue.candidates.length, error: issue.error });
        const resolved = resolveNankaiHistoricalOfficialArticle(article, issue.candidates);
        if (resolved) {
          patched = { ...resolved, issue_date: article.issue_date || issueDate, matched_issue_date: issueDate, date_source: article.date_source || "ncpssd_historical_title_match" };
          break;
        }
      }
    }

    if (!patched) {
      for (const nbrUrl of nbrUrlsForArticle(article)) {
        const nbr = await nbrCandidates(nbrUrl);
        evidence.push({ source: "nbr.nankai.edu.cn", nbr_url: nbr.nbr_url, status: nbr.status, candidates: nbr.candidates.length, error: nbr.error });
        const resolved = resolveNankaiHistoricalOfficialArticle(article, nbr.candidates);
        if (resolved) {
          patched = resolved;
          break;
        }
      }
    }

    const reason = patched
      ? patched.link_note
      : evidence.some((entry) => entry.status === 403 || entry.status === 401 || entry.status === 412)
        ? "source_access_protected"
        : evidence.some((entry) => entry.error === "timeout")
          ? "source_timeout"
          : "title_not_found";
    results.push({
      article: patched || article,
      addedLink: Boolean(patched),
      issue_date_candidates: [...primaryIssueDates, ...historicalIssueDatesForArticle(article)],
      evidence,
      reason,
    });
    console.log(JSON.stringify({ journal: article.journal_name, title: article.title.slice(0, 58), linked: Boolean(patched), reason }));
  }

  const pushQueue = results.filter((result) => result.addedLink).map((result) => result.article);
  const workflow = {
    summary: {
      checked_at: new Date().toISOString(),
      since: "2000-01-01",
      until: today(),
      sources_total: history.summary?.sources_total || 22,
      sources_ready: history.summary?.sources_ready || 20,
      push_queue_articles: pushQueue.length,
      nankai_official_link_backfill: true,
      nankai_candidates_checked: targets.length,
      nankai_links_added: pushQueue.length,
      nankai_links_remaining: targets.length - pushQueue.length,
      nankai_links_applied: false,
      backfill_sources: ["ncpssd-issue-title-match", "nbr.nankai.edu.cn-title-match"],
    },
    push_queue: pushQueue,
    results,
  };
  await writeFile(new URL(output, `file://${process.cwd()}/`), `${JSON.stringify(workflow, null, 2)}\n`, "utf8");
  if (pushQueue.length) {
    await execFileAsync(process.execPath, ["scripts/build-front-data.mjs", `--workflow=${output}`], {
      cwd: new URL("..", import.meta.url),
      maxBuffer: 64 * 1024 * 1024,
    });
    await execFileAsync(process.execPath, ["scripts/build-topic-search-index.mjs"], {
      cwd: new URL("..", import.meta.url),
      maxBuffer: 64 * 1024 * 1024,
    });
    workflow.summary.nankai_links_applied = true;
    await writeFile(new URL(output, `file://${process.cwd()}/`), `${JSON.stringify(workflow, null, 2)}\n`, "utf8");
  }
  console.log(`WROTE ${pushQueue.length}/${targets.length} ${output}`);
}

if (process.argv[1] && import.meta.url === new URL(process.argv[1], "file://").href) {
  await main();
}

export {
  compactText,
  historicalIssueDatesForArticle,
  issueDatesForArticle,
  parseNbrAnchors,
};
