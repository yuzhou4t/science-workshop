import { readFile, writeFile } from "node:fs/promises";
import { setTimeout as sleep } from "node:timers/promises";

import { extractHtmlArticleHints } from "./date-enhancement-lib.mjs";

const historyPath = new URL("../data/push-history.json", import.meta.url);

function cliValue(name) {
  return process.argv.slice(2).find((arg) => arg.startsWith(`${name}=`))?.slice(name.length + 1);
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function decodeHtml(value = "") {
  return String(value)
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#(\d+);/g, (_match, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_match, code) => String.fromCodePoint(Number.parseInt(code, 16)));
}

function stripTags(value = "") {
  return decodeHtml(String(value).replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

function compactTitle(value = "") {
  return stripTags(value)
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[“”„‟‘’]/g, '"')
    .replace(/[：﹕]/g, ":")
    .replace(/[‐‑‒–—]/g, "-")
    .replace(/[^\p{L}\p{N}]+/gu, "")
    .trim();
}

function titleMatches(expected = "", actual = "") {
  const left = compactTitle(expected);
  const right = compactTitle(actual);
  if (!left || !right) return false;
  if (left === right) return true;
  const truncated = left.replace(/(?:\.{2,}|…+)$/u, "");
  return truncated.length >= 12 && right.startsWith(truncated);
}

function pageTitleCandidates(html = "") {
  const values = [];
  for (const tag of String(html).match(/<meta\b[^>]*>/gi) || []) {
    const name = tag.match(/\b(?:name|property)=["']([^"']+)["']/i)?.[1]?.toLowerCase() || "";
    if (!["citation_title", "dc.title", "og:title"].includes(name)) continue;
    const content = tag.match(/\bcontent=["']([^"']+)["']/i)?.[1] || "";
    if (content) values.push(decodeHtml(content));
  }
  for (const pattern of [/<title\b[^>]*>([\s\S]*?)<\/title>/i, /<h1\b[^>]*>([\s\S]*?)<\/h1>/i]) {
    const value = String(html).match(pattern)?.[1] || "";
    if (value) values.push(stripTags(value));
  }
  return values;
}

export function extractStrictOfficialHtmlAbstract(article, html) {
  if (!pageTitleCandidates(html).some((title) => titleMatches(article.title, title))) return null;
  const hints = extractHtmlArticleHints({ url: article.url || article.official_url || "", context: html });
  const abstract = String(hints.abstract || "").trim();
  if (abstract.length < 40) return null;
  return {
    abstract,
    ...(hints.keywords?.length ? { keywords: hints.keywords } : {}),
  };
}

function targetArticles(history) {
  const journals = new Set((cliValue("--journals") || "").split(",").map((value) => value.trim()).filter(Boolean));
  const firstSeenAt = cliValue("--first-seen-at") || "";
  const limit = Number(cliValue("--limit") || 0);
  const articles = (history.articles || [])
    .filter((article) => !String(article.abstract || "").trim())
    .filter((article) => !firstSeenAt || article.first_seen_at === firstSeenAt)
    .filter((article) => !journals.size || journals.has(article.journal_name))
    .filter((article) => /^https?:\/\//i.test(article.url || article.official_url || ""));
  return limit > 0 ? articles.slice(0, limit) : articles;
}

async function fetchText(url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      redirect: "follow",
      headers: {
        "User-Agent": "Mozilla/5.0 ScienceWorkshop/0.2 (official HTML abstract backfill)",
        Accept: "text/html,application/xhtml+xml,*/*;q=0.8",
      },
      signal: controller.signal,
    });
    return {
      ok: response.ok,
      status: response.status,
      url: response.url || url,
      text: await response.text(),
      error: response.ok ? "" : `status_${response.status}`,
    };
  } catch (error) {
    return { ok: false, status: 0, url, text: "", error: error.name === "AbortError" ? "timeout" : error.message };
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  const history = JSON.parse(await readFile(historyPath, "utf8"));
  const output = cliValue("--output") || `data/recent-articles-official-html-abstracts-${today()}.json`;
  const timeoutMs = Number(cliValue("--timeout-ms") || 15000);
  const delayMs = Number(cliValue("--delay-ms") || 300);
  const articles = targetArticles(history);
  const results = [];

  for (const article of articles) {
    const sourceUrl = article.url || article.official_url;
    const response = await fetchText(sourceUrl, timeoutMs);
    const hints = response.ok ? extractStrictOfficialHtmlAbstract(article, response.text) : null;
    const patched = hints ? { ...article, ...hints } : article;
    results.push({
      article: patched,
      addedAbstract: Boolean(hints?.abstract),
      source: hints ? "official-html" : "",
      response: {
        status: response.status,
        final_url: response.url,
        error: response.error || (response.ok ? "strict_title_or_abstract_not_found" : ""),
      },
    });
    console.log(JSON.stringify({ journal: article.journal_name, title: article.title.slice(0, 58), abstract: Boolean(hints), status: response.status }));
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
      official_html_abstract_backfill: true,
      backfill_sources: ["official-article-html"],
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
