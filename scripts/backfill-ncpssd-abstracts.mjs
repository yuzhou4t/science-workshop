import { readFile, writeFile } from "node:fs/promises";
import { setTimeout as sleep } from "node:timers/promises";

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

export function ncpssdParamsFromUrl(rawUrl = "") {
  try {
    const url = new URL(rawUrl);
    if (!/\.ncpssd\.org$/i.test(url.hostname)) return {};
    const id = url.searchParams.get("id") || "";
    if (!id) return {};
    return {
      id,
      type: url.searchParams.get("typename") || "中文期刊文章",
    };
  } catch {
    return {};
  }
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

function patchFromNcpssdData(article, data = {}) {
  const patched = { ...article };
  const abstract = stripTags(data.remarkc || data.remark || "");
  if (abstract && abstract !== "暂无") patched.abstract = abstract;
  const keywords = splitKeywords(data.keywordc || data.keyword || "");
  if (keywords.length) patched.keywords = keywords;
  if (!patched.authors && data.showwriter) patched.authors = splitKeywords(data.showwriter).join(", ");
  if (!patched.issue_date && data.years && data.num) patched.issue_date = `${data.years}-${String(data.num).padStart(2, "0")}`;
  return patched;
}

async function postNcpssd(article, timeoutMs) {
  const params = ncpssdParamsFromUrl(article.url || article.official_url || "");
  if (!params.id) return { ok: false, status: 0, error: "missing_ncpssd_id" };
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
        Referer: article.url || article.official_url || "https://www.ncpssd.org/",
      },
      body: JSON.stringify({ lngid: params.id, type: params.type, pageType: 1 }),
      signal: controller.signal,
    });
    const text = await response.text();
    let payload = {};
    try {
      payload = JSON.parse(text);
    } catch {
      return { ok: false, status: response.status, error: "json_parse_failed" };
    }
    return { ok: response.ok, status: response.status, data: payload.data || {} };
  } catch (error) {
    return { ok: false, status: 0, error: error.name === "AbortError" ? "timeout" : error.message };
  } finally {
    clearTimeout(timer);
  }
}

async function fetchWithRetries(article, options) {
  let last = {};
  for (let attempt = 1; attempt <= options.retries; attempt += 1) {
    last = await postNcpssd(article, options.timeoutMs);
    if (last.ok && last.data) return { ...last, attempt };
    await sleep(options.delayMs * attempt);
  }
  return { ...last, attempt: options.retries };
}

function targetArticles(history) {
  const limit = Number(cliValue("--limit") || 0);
  const firstSeenAt = cliValue("--first-seen-at") || "";
  const articles = (history.articles || [])
    .filter((article) => !article.abstract)
    .filter((article) => !firstSeenAt || article.first_seen_at === firstSeenAt)
    .filter((article) => /\.ncpssd\.org/i.test(article.url || article.official_url || ""));
  return limit > 0 ? articles.slice(0, limit) : articles;
}

async function writeWorkflow(output, history, results) {
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
      ncpssd_api_backfill: true,
      backfill_sources: ["ncpssd-article-api"],
    },
    push_queue: pushQueue,
    results,
  };
  await writeFile(new URL(output, `file://${process.cwd()}/`), `${JSON.stringify(workflow, null, 2)}\n`, "utf8");
}

async function main() {
  const output = cliValue("--output") || `data/recent-articles-ncpssd-abstract-backfill-${today()}.json`;
  const history = JSON.parse(await readFile(historyPath, "utf8"));
  const articles = targetArticles(history);
  const options = {
    timeoutMs: Number(cliValue("--timeout-ms") || 20000),
    delayMs: Number(cliValue("--delay-ms") || 3000),
    retries: Number(cliValue("--retries") || 3),
  };
  const results = [];

  for (const article of articles) {
    const response = await fetchWithRetries(article, options);
    const patched = response.ok ? patchFromNcpssdData(article, response.data) : article;
    const result = {
      article: patched,
      addedAbstract: Boolean(patched.abstract),
      keywords: patched.keywords?.length || 0,
      response: {
        status: response.status,
        attempt: response.attempt,
        error: response.error || "",
      },
    };
    results.push(result);
    await writeWorkflow(output, history, results);
    console.log(JSON.stringify({
      title: article.title.slice(0, 36),
      abstract: result.addedAbstract,
      keywords: result.keywords,
      status: response.status,
      attempt: response.attempt,
      error: response.error || "",
    }));
    await sleep(options.delayMs);
  }

  const count = results.filter((result) => result.addedAbstract).length;
  console.log(`WROTE ${count}/${articles.length} ${output}`);
}

if (process.argv[1] && import.meta.url === new URL(process.argv[1], "file://").href) {
  await main();
}
