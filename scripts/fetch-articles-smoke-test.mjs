import { readFile, writeFile } from "node:fs/promises";

const registryPath = new URL("../data/adapter-profiles.json", import.meta.url);
const registry = JSON.parse(await readFile(registryPath, "utf8"));

const headers = {
  "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/126 Safari/537.36 ScienceWorkshopProbe/0.1",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,application/rss+xml;q=0.9,application/atom+xml;q=0.9,*/*;q=0.5",
};

function decodeEntities(value = "") {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, num) => String.fromCodePoint(Number(num)));
}

function stripTags(value = "") {
  return decodeEntities(value.replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<style[\s\S]*?<\/style>/gi, "").replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeUrl(href, base) {
  try {
    return new URL(href, base).toString();
  } catch {
    return "";
  }
}

async function fetchText(url, timeoutMs = 9000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const started = Date.now();
  try {
    const response = await fetch(url, { redirect: "follow", headers, signal: controller.signal });
    const contentType = response.headers.get("content-type") || "";
    const buffer = await response.arrayBuffer();
    const charset = contentType.match(/charset=([^;\s]+)/i)?.[1]?.toLowerCase();
    let decoder = new TextDecoder("utf-8");
    if (charset && !["utf-8", "utf8"].includes(charset)) {
      try {
        decoder = new TextDecoder(charset === "gb2312" ? "gb18030" : charset);
      } catch {}
    }
    return {
      ok: response.ok,
      status: response.status,
      finalUrl: response.url,
      contentType,
      text: decoder.decode(buffer),
      ms: Date.now() - started,
    };
  } catch (error) {
    return {
      ok: false,
      status: "ERR",
      finalUrl: url,
      contentType: "",
      text: "",
      error: error.name === "AbortError" ? "timeout" : error.message,
      ms: Date.now() - started,
    };
  } finally {
    clearTimeout(timer);
  }
}

function parseXmlFeed(text, baseUrl) {
  const items = [];
  const blocks = [...text.matchAll(/<(item|entry)\b[\s\S]*?<\/\1>/gi)].map((match) => match[0]);
  for (const block of blocks) {
    const title = stripTags(block.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "");
    const rssLink = stripTags(block.match(/<link[^>]*>([\s\S]*?)<\/link>/i)?.[1] || "");
    const atomLink = block.match(/<link\b[^>]*href=["']([^"']+)["'][^>]*>/i)?.[1] || "";
    const guid = stripTags(block.match(/<guid[^>]*>([\s\S]*?)<\/guid>/i)?.[1] || "");
    const date = stripTags(block.match(/<(pubDate|updated|published)[^>]*>([\s\S]*?)<\/\1>/i)?.[2] || "");
    const link = normalizeUrl(rssLink || atomLink || guid, baseUrl);
    if (title && link) items.push({ title, url: link, date });
  }
  return dedupeArticles(items).slice(0, 8);
}

function parseAnchors(text, baseUrl) {
  const anchors = [];
  const anchorRegex = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
  for (const match of text.matchAll(anchorRegex)) {
    const attrs = match[1];
    const href = attrs.match(/\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/i)?.slice(1).find(Boolean);
    if (!href || href.startsWith("#") || href.startsWith("javascript:")) continue;
    const title = stripTags(match[2]);
    if (!looksLikeArticleTitle(title)) continue;
    const url = normalizeUrl(href, baseUrl);
    if (!url || !looksLikeArticleUrl(url, title)) continue;
    anchors.push({ title, url, date: "" });
  }
  return dedupeArticles(anchors).slice(0, 8);
}

function looksLikeArticleTitle(title) {
  if (!title) return false;
  const compact = title.replace(/\s/g, "");
  if (compact.length < 8) return false;
  if (/^(首页|目录|过刊|下载|摘要|全文|作者|更多|下一页|上一页|中文|English|View|PDF|HTML|Abstract|Current Issue)$/i.test(title)) return false;
  if (/[：:]/.test(title) && compact.length < 16) return false;
  return /[\u4e00-\u9fff]{4,}|[A-Za-z]{4,}\s+[A-Za-z]{3,}/.test(title);
}

function looksLikeArticleUrl(url, title) {
  const lower = url.toLowerCase();
  if (/article|abstract|paper|doi|issue|magazine|y20\d{2}|contentid|paperid|browse(detail|periodical)|\/cn\/y|\/article\//.test(lower)) return true;
  return /[\u4e00-\u9fff]/.test(title) && title.length > 14;
}

function dedupeArticles(items) {
  const seen = new Set();
  const deduped = [];
  for (const item of items) {
    const key = `${item.title}::${item.url}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(item);
  }
  return deduped;
}

async function runPool(items, concurrency, worker) {
  const results = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await worker(items[index], index);
    }
  }));
  return results;
}

async function testDirectFeed(feed) {
  const response = await fetchText(feed.feed_url, 9000);
  const articles = response.ok ? parseXmlFeed(response.text, response.finalUrl) : [];
  return {
    type: "direct_rss",
    journal_id: feed.journal_id,
    journal_name: feed.journal_name,
    source_url: feed.feed_url,
    status: response.status,
    content_type: response.contentType,
    ok: articles.length > 0,
    article_count: articles.length,
    samples: articles.slice(0, 3),
    error: response.error || "",
  };
}

async function testAdapterSource(item) {
  const response = await fetchText(item.source_url, 9000);
  const articles = response.ok ? parseAnchors(response.text, response.finalUrl) : [];
  return {
    type: "adapter_source",
    journal_id: item.journal_id,
    journal_name: item.journal_name,
    platform_id: item.platform_id,
    source_url: item.source_url,
    status: response.status,
    content_type: response.contentType,
    ok: articles.length > 0,
    article_count: articles.length,
    samples: articles.slice(0, 3),
    error: response.error || "",
  };
}

const directResults = await runPool(registry.direct_article_feeds, 4, testDirectFeed);
const adapterResults = await runPool(registry.adapter_queue, 5, testAdapterSource);
const allResults = [...directResults, ...adapterResults];

const summary = {
  checked_at: new Date().toISOString(),
  direct_feeds_total: directResults.length,
  direct_feeds_ok: directResults.filter((item) => item.ok).length,
  adapter_sources_total: adapterResults.length,
  adapter_sources_with_candidates: adapterResults.filter((item) => item.ok).length,
  adapter_sources_need_rules: adapterResults.filter((item) => !item.ok).length,
};

const result = { summary, results: allResults };
await writeFile(new URL("../data/fetch-smoke-results.json", import.meta.url), JSON.stringify(result, null, 2));

console.log(JSON.stringify(summary, null, 2));
for (const item of allResults) {
  const mark = item.ok ? "OK" : "NEEDS_RULE";
  const sample = item.samples[0]?.title || item.error || item.content_type || "";
  console.log(`${mark.padEnd(10)} ${item.journal_id.padEnd(4)} ${item.journal_name} | ${item.article_count} | ${sample}`);
}
