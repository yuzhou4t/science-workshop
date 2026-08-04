import { readFile, writeFile } from "node:fs/promises";
import { setTimeout as sleep } from "node:timers/promises";

const historyPath = new URL("../data/push-history.json", import.meta.url);
const JOURNAL = "AMERICAN ECONOMIC REVIEW";

function cliValue(name) {
  return process.argv.slice(2).find((arg) => arg.startsWith(`${name}=`))?.slice(name.length + 1);
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function normalizeTitle(value = "") {
  return String(value)
    .normalize("NFKC")
    .replace(/[\u2010-\u2015]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

function stripTags(value = "") {
  return String(value)
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/\s+/g, " ")
    .trim();
}

function pageTitleMatches(expected, pageTitle) {
  const target = normalizeTitle(expected);
  const actual = normalizeTitle(stripTags(pageTitle))
    .replace(/ - American Economic Association$/, "")
    .trim();
  if (!target || !actual) return false;
  return actual === target || actual.startsWith(target) || target.startsWith(actual);
}

function extractAbstractSection(html) {
  const match = String(html).match(
    /<section\b[^>]*class=["'][^"']*\barticle-information\b[^"']*\babstract\b[^"']*["'][^>]*>([\s\S]*?)<\/section>/i,
  );
  if (!match) return "";
  const body = match[1].replace(/<h4\b[^>]*>[\s\S]*?<\/h4>/i, " ");
  return stripTags(body);
}

async function fetchDetail(url, timeoutMs) {
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

async function main() {
  const output = cliValue("--output") || `data/recent-articles-aer-web-backfill-${today()}.json`;
  const timeoutMs = Number(cliValue("--timeout-ms") || 15000);
  const delayMs = Number(cliValue("--delay-ms") || 1200);
  const history = JSON.parse(await readFile(historyPath, "utf8"));
  const articles = (history.articles || []).filter(
    (article) => article.journal_name === JOURNAL && !String(article.abstract || "").trim(),
  );

  const results = [];
  for (const article of articles) {
    const detailUrl = article.official_url || article.url || "";
    if (!/^https:\/\/www\.aeaweb\.org\/articles\?/.test(detailUrl)) {
      results.push({ article, addedAbstract: false, error: "not_aeaweb_detail" });
      continue;
    }
    const response = await fetchDetail(detailUrl, timeoutMs);
    if (!response.ok) {
      results.push({ article, addedAbstract: false, response: { status: response.status, error: response.error || "" } });
      console.log(JSON.stringify({ journal: article.journal_name, title: article.title.slice(0, 40), abstract: false, status: response.status, error: response.error || "http_error" }));
      await sleep(delayMs);
      continue;
    }
    const titleMatch = response.text.match(/<title>([\s\S]*?)<\/title>/i)?.[1] || "";
    if (!pageTitleMatches(article.title, titleMatch)) {
      results.push({ article, addedAbstract: false, response: { status: response.status, error: "title_not_matched" } });
      console.log(JSON.stringify({ journal: article.journal_name, title: article.title.slice(0, 40), abstract: false, status: response.status, error: "title_not_matched" }));
      await sleep(delayMs);
      continue;
    }
    const abstract = extractAbstractSection(response.text);
    const patched = {
      ...article,
      abstract: abstract.length >= 50 ? abstract : article.abstract || "",
      official_source: abstract.length >= 50 ? "aeaweb-detail" : article.official_source || "",
    };
    results.push({
      article: patched,
      addedAbstract: Boolean(patched.abstract),
      response: { status: response.status, abstract_length: patched.abstract ? patched.abstract.length : 0 },
    });
    console.log(JSON.stringify({ journal: article.journal_name, title: article.title.slice(0, 40), abstract: Boolean(patched.abstract), status: response.status, error: "" }));
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
      aer_web_backfill: true,
      backfill_sources: ["aeaweb-detail-abstract"],
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
