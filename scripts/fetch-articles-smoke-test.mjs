import { execFile } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const registryPath = new URL("../data/adapter-profiles.json", import.meta.url);
const registry = JSON.parse(await readFile(registryPath, "utf8"));
const profileById = new Map(registry.platform_profiles.map((profile) => [profile.id, profile]));

const headers = {
  "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/126 Safari/537.36 ScienceWorkshopProbe/0.2",
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
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&rsquo;/g, "'")
    .replace(/&lsquo;/g, "'")
    .replace(/&ldquo;/g, '"')
    .replace(/&rdquo;/g, '"')
    .replace(/&mdash;/g, "-")
    .replace(/&ndash;/g, "-")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, num) => String.fromCodePoint(Number(num)));
}

function stripTags(value = "") {
  return decodeEntities(
    value
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/\s+/g, " ")
    .trim();
}

function textDecoderFor(contentType = "") {
  const charset = contentType.match(/charset=([^;\s]+)/i)?.[1]?.toLowerCase();
  let encoding = "utf-8";
  if (charset && !["utf-8", "utf8"].includes(charset)) encoding = charset === "gb2312" ? "gb18030" : charset;
  try {
    return new TextDecoder(encoding);
  } catch {
    return new TextDecoder("utf-8");
  }
}

function normalizeUrl(href, base) {
  try {
    return new URL(href, base).toString();
  } catch {
    return "";
  }
}

function cleanArticleUrl(url) {
  if (!url) return "";
  const fixed = url.replace(/\?&/, "?").replace(/&&/g, "&");
  try {
    const parsed = new URL(fixed);
    if (!parsed.hash.startsWith("#/issueDetail")) parsed.hash = "";
    for (const key of [...parsed.searchParams.keys()]) {
      if (/^utm_/i.test(key) || key === "af" || key === "from" || key === "_gl") parsed.searchParams.delete(key);
    }
    return parsed.toString();
  } catch {
    return fixed;
  }
}

async function fetchWithCurl(url, timeoutMs, extraHeaders = {}, started = Date.now()) {
  const args = [
    "-L",
    "--max-time",
    String(Math.ceil(timeoutMs / 1000)),
    "-sS",
    "-A",
    extraHeaders["User-Agent"] || headers["User-Agent"],
    "-H",
    `Accept: ${extraHeaders.Accept || headers.Accept}`,
  ];

  if (extraHeaders.Origin) args.push("-H", `Origin: ${extraHeaders.Origin}`);
  if (extraHeaders.Referer) args.push("-H", `Referer: ${extraHeaders.Referer}`);

  args.push("-w", "\n__SCIENCE_WORKSHOP_CURL_META__%{http_code}\t%{content_type}\t%{url_effective}", url);

  const parseCurlOutput = (stdout, fallbackError = "") => {
    const marker = Buffer.from("\n__SCIENCE_WORKSHOP_CURL_META__");
    const markerIndex = stdout.lastIndexOf(marker);
    if (markerIndex === -1) return null;

    const body = stdout.subarray(0, markerIndex);
    const [statusText, contentType = "", finalUrl = url] = stdout.subarray(markerIndex + marker.length).toString("utf8").trim().split("\t");
    const status = Number(statusText);
    const text = textDecoderFor(contentType).decode(body);
    return {
      ok: status >= 200 && status < 400,
      status,
      finalUrl,
      contentType,
      text,
      transport: "curl",
      error: fallbackError,
      ms: Date.now() - started,
    };
  };

  const compactCurlError = (error) => {
    const raw = error.stderr?.toString("utf8") || error.message || "";
    return raw.trim().split("\n").slice(0, 3).join(" ");
  };

  try {
    const { stdout } = await execFileAsync("curl", args, { encoding: "buffer", maxBuffer: 24 * 1024 * 1024 });
    const parsed = parseCurlOutput(stdout);
    if (!parsed) throw new Error("curl meta marker missing");
    return parsed;
  } catch (error) {
    const compactError = compactCurlError(error);
    if (error.stdout?.length) {
      const parsed = parseCurlOutput(error.stdout, compactError);
      if (parsed?.text) return parsed;
    }
    return {
      ok: false,
      status: "ERR",
      finalUrl: url,
      contentType: "",
      text: "",
      transport: "curl",
      error: compactError,
      ms: Date.now() - started,
    };
  }
}

async function fetchText(url, timeoutMs = 10000, extraHeaders = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const started = Date.now();
  try {
    const response = await fetch(url, {
      redirect: "follow",
      headers: { ...headers, ...extraHeaders },
      signal: controller.signal,
    });
    const contentType = response.headers.get("content-type") || "";
    const buffer = await response.arrayBuffer();
    return {
      ok: response.ok,
      status: response.status,
      finalUrl: response.url,
      contentType,
      text: textDecoderFor(contentType).decode(buffer),
      transport: "fetch",
      ms: Date.now() - started,
    };
  } catch (error) {
    clearTimeout(timer);
    return fetchWithCurl(url, timeoutMs + 6000, extraHeaders, started).then((curlResponse) => ({
      ...curlResponse,
      fetch_error: error.name === "AbortError" ? "timeout" : error.message,
    }));
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
    const link = cleanArticleUrl(normalizeUrl(rssLink || atomLink || guid, baseUrl));
    if (title && link) items.push({ title, url: link, date });
  }
  return dedupeArticles(items);
}

function parseRawAnchors(text, baseUrl) {
  const anchors = [];
  const anchorRegex = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
  for (const match of text.matchAll(anchorRegex)) {
    const attrs = match[1];
    const href = attrs.match(/\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/i)?.slice(1).find(Boolean);
    if (!href || href.startsWith("#")) continue;
    anchors.push({
      rawHref: decodeEntities(href),
      title: stripTags(match[2]),
      url: normalizeUrl(decodeEntities(href), baseUrl),
    });
  }
  return anchors;
}

function matchesAny(value, patterns) {
  return patterns.some((pattern) => pattern.test(value));
}

function parseAnchorsMatching(text, baseUrl, options = {}) {
  const {
    include = [],
    exclude = [],
    mapHref = null,
    requireArticleTitle = true,
  } = options;

  const articles = [];
  for (const anchor of parseRawAnchors(text, baseUrl)) {
    const mappedHref = mapHref ? mapHref(anchor.rawHref, anchor.title) : anchor.rawHref;
    if (!mappedHref || mappedHref.startsWith("#") || (mappedHref.startsWith("javascript:") && !mapHref)) continue;
    const url = cleanArticleUrl(normalizeUrl(mappedHref, baseUrl));
    if (!url) continue;

    const haystack = `${anchor.rawHref} ${url} ${anchor.title}`;
    if (include.length && !matchesAny(haystack, include)) continue;
    if (exclude.length && matchesAny(haystack, exclude)) continue;
    if (requireArticleTitle && !looksLikeArticleTitle(anchor.title)) continue;

    articles.push({ title: anchor.title, url, date: "" });
  }
  return dedupeArticles(articles);
}

function looksLikeArticleTitle(title) {
  if (!title) return false;
  const compact = title.replace(/\s/g, "");
  if (compact.length < 6) return false;
  if (/^(首页|目录|过刊|下载|摘要|全文|作者|更多|下一页|上一页|中文|English|View|PDF|HTML|Abstract|Current Issue|Forthcoming Articles|Read article online|View PDF)$/i.test(title)) {
    return false;
  }
  if (/^(American Economic Review|Journal of Finance|Administrative Science Quarterly)$/i.test(title)) return false;
  if (/^[A-Z\s&/.-]+$/.test(title) && compact.length < 18) return false;
  return /[\u4e00-\u9fff]{4,}|[A-Za-z]{3,}\s+[A-Za-z]{3,}/.test(title);
}

function isNonArticleTitle(title) {
  return /^(announcements?|frontmatter|front matter|backmatter|back matter|contents?|cover|masthead|issue information)$/i.test(title)
    || /^(front|back)\s?matter\b/i.test(title)
    || /annual report of the editor/i.test(title)
    || /election of fellows/i.test(title)
    || /^front matter$/i.test(title);
}

function dedupeArticles(items) {
  const seen = new Set();
  const deduped = [];
  for (const item of items) {
    const url = cleanArticleUrl(item.url);
    const key = url || `${item.title}::${item.date || ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push({ ...item, url });
  }
  return deduped;
}

function originFromSource(sourceUrl) {
  try {
    const parsed = new URL(sourceUrl);
    return parsed.origin;
  } catch {
    return sourceUrl.split("#")[0].replace(/\/$/, "");
  }
}

function articleRouteFromSource(sourceUrl, id) {
  const origin = originFromSource(sourceUrl);
  return `${origin}/#/issueDetail?id=${id}`;
}

function flattenAjcassArticles(payload) {
  const rows = [];
  const walk = (value) => {
    if (Array.isArray(value)) {
      for (const item of value) walk(item);
      return;
    }
    if (!value || typeof value !== "object") return;

    if (value.id && value.title && (value.authors || value.enTitle || value.yearVolumeIssue || value.filePath)) rows.push(value);
    for (const key of ["data", "channels", "issueInfoList"]) walk(value[key]);
  };
  walk(payload);
  return rows;
}

async function extractAjcassCurrentApi(item) {
  const journalPlatformId = item.adapter_rule?.journal_platform_id;
  const origin = originFromSource(item.source_url);
  const probeUrl = `https://api.ajcass.com/api/SiteWebApi/GetCurrentPeriodMutiChannel?JournalID=${journalPlatformId}`;
  const response = await fetchText(probeUrl, 12000, {
    Accept: "application/json,text/plain,*/*",
    Origin: origin,
    Referer: `${origin}/`,
  });

  let articles = [];
  let notes = [];
  if (response.ok) {
    try {
      const payload = JSON.parse(response.text);
      articles = flattenAjcassArticles(payload).map((row) => ({
        title: stripTags(row.title),
        url: articleRouteFromSource(item.source_url, row.id),
        date: row.year && row.issue ? `${row.year}-${String(row.issue).padStart(2, "0")}` : "",
        authors: stripTags(row.authors || ""),
      })).filter((article) => looksLikeArticleTitle(article.title));
    } catch (error) {
      notes.push(`json_parse_failed: ${error.message}`);
    }
  }

  return { response, probe_url: probeUrl, articles: dedupeArticles(articles), candidate_count: articles.length, notes };
}

async function extractHtmlByPatterns(item, patternOptions, timeoutMs = 11000) {
  const response = await fetchText(item.source_url, timeoutMs);
  const articles = response.ok ? parseAnchorsMatching(response.text, response.finalUrl, patternOptions) : [];
  return { response, probe_url: item.source_url, articles, candidate_count: articles.length, notes: [] };
}

async function extractCnkiCaptchaCheck(item) {
  const response = await fetchText(item.source_url, 12000);
  const notes = [];
  if (/showValidateCode|验证码|validatecode/i.test(response.text) || /showValidateCode/i.test(response.finalUrl)) {
    notes.push("captcha_required");
  }
  const articles = response.ok && !notes.length
    ? parseAnchorsMatching(response.text, response.finalUrl, {
      include: [/\/portal\/journal\/portal\/client\/paper\/[a-z0-9-]+/i],
      exclude: [/\/editor\b/i, /admin/i],
    })
    : [];
  return { response, probe_url: item.source_url, articles, candidate_count: articles.length, notes };
}

async function extractJmscIssueHtml(item) {
  const indexResponse = await fetchText(item.source_url, 12000);
  const notes = [];
  if (!indexResponse.ok) return { response: indexResponse, probe_url: item.source_url, articles: [], candidate_count: 0, notes };

  const issueLinks = dedupeArticles(
    parseRawAnchors(indexResponse.text, indexResponse.finalUrl)
      .filter((anchor) => /\/jmsc\/article\/issue\/20\d{2}_\d+/i.test(anchor.url))
      .map((anchor) => {
        const issueUrl = /^jmsc\//i.test(anchor.rawHref)
          ? normalizeUrl(`/${anchor.rawHref}`, indexResponse.finalUrl)
          : anchor.url;
        return { title: anchor.title || issueUrl, url: issueUrl, date: "" };
      }),
  );

  if (!issueLinks.length) {
    notes.push("latest_issue_link_not_found");
    return { response: indexResponse, probe_url: item.source_url, articles: [], candidate_count: 0, notes };
  }

  const issueResponse = await fetchText(issueLinks[0].url, 12000);
  const articles = issueResponse.ok
    ? parseAnchorsMatching(issueResponse.text, issueResponse.finalUrl, {
      include: [/\/jmsc\/article\/abstract\/\d+/i],
      exclude: [/\/jmsc\/article\/issue\//i],
      mapHref: (href) => (/^jmsc\//i.test(href) ? `/${href}` : href),
    })
    : [];

  return {
    response: issueResponse,
    probe_url: issueLinks[0].url,
    articles,
    candidate_count: issueLinks.length,
    notes: [`issue_candidates:${issueLinks.length}`],
  };
}

async function extractAscIssueList(item) {
  const response = await fetchText(item.source_url, 12000);
  const notes = [];
  const issueLinks = response.ok
    ? dedupeArticles(parseRawAnchors(response.text, response.finalUrl)
      .filter((anchor) => /ArticleList\.aspx\?year=\d{4}&issue=\d+/i.test(anchor.url))
      .map((anchor) => ({ title: anchor.title || anchor.url, url: anchor.url, date: "" })))
    : [];

  if (!issueLinks.length) {
    notes.push("issue_links_not_found");
    return { response, probe_url: item.source_url, articles: [], candidate_count: 0, notes };
  }

  const issueResponse = await fetchText(issueLinks[issueLinks.length - 1].url, 12000);
  const articles = issueResponse.ok
    ? parseAnchorsMatching(issueResponse.text, issueResponse.finalUrl, {
      include: [/ArticleDetail\.aspx/i, /BrowseDetail\.aspx/i],
    })
    : [];

  if (!articles.length) notes.push("issue_page_has_no_article_links");
  return {
    response: issueResponse,
    probe_url: issueLinks[issueLinks.length - 1].url,
    articles,
    candidate_count: issueLinks.length,
    notes,
  };
}

async function extractAfaForthcomingDoi(item) {
  return extractHtmlByPatterns(item, {
    include: [/10\.1111\/jofi\.\d+/i],
    mapHref: (href, title) => {
      const match = href.match(/viewDoc\(['"]([^'"]+)['"]/i);
      if (!match || !looksLikeArticleTitle(title)) return "";
      return `https://onlinelibrary.wiley.com/doi/${match[1]}`;
    },
  }, 14000);
}

async function extractNankaiProtectedHtml(item) {
  const response = await fetchText(item.source_url, 12000);
  const notes = [];
  if (/\$_ts|nsd=|r=['"]m['"]/i.test(response.text)) notes.push("client_challenge_or_page_protection");
  const articles = response.ok && !notes.length
    ? parseAnchorsMatching(response.text, response.finalUrl, {
      include: [/article|paper|detail|content/i],
      exclude: [/login|admin|editor/i],
    })
    : [];
  return { response, probe_url: item.source_url, articles, candidate_count: articles.length, notes };
}

async function extractAdapterArticles(item) {
  const kind = item.adapter_rule?.kind || item.platform_id;
  switch (kind) {
    case "ajcass-current-api":
      return extractAjcassCurrentApi(item);
    case "cie-legacy-html":
      return extractHtmlByPatterns(item, {
        include: [/\/Magazine\/Show\?id=\d+/i],
        exclude: [/Admin\/|CommonBlock\/|SiteContent/i],
      }, 17000);
    case "magtech-cn-html":
      return extractHtmlByPatterns(item, {
        include: [/\/CN\/Y20\d{2}\/V\d+\/I\d+\/\d+/i],
        exclude: [/#bccl/i, /archive_by_years/i, /\/CN\/Y20\d{2}\/V\d+\/I\d+$/i],
      });
    case "jryj-html":
      return extractHtmlByPatterns(item, {
        include: [/\/CN\/abstract\/abstract\d+\.shtml/i, /\/CN\/Y20\d{2}\/V\d+\/I\d+\/\d+/i],
        exclude: [/\/CN\/column\//i, /volumn/i, /showOldVolumnList/i],
      });
    case "cnki-captcha-check":
      return extractCnkiCaptchaCheck(item);
    case "cnki-portal-paper":
      return extractHtmlByPatterns(item, {
        include: [/\/portal\/journal\/portal\/client\/paper\/[a-z0-9-]+/i],
        exclude: [/\/editor\b/i, /admin/i, /login/i],
      }, 13000);
    case "nankai-protected-html":
      return extractNankaiProtectedHtml(item);
    case "jmsc-issue-html":
      return extractJmscIssueHtml(item);
    case "asc-issue-list":
      return extractAscIssueList(item);
    case "aaahq-issue-html":
      return extractHtmlByPatterns(item, {
        include: [/\/accounting-review\/article\//i, /\/doi\/10\.2308\//i],
        exclude: [/login|register|search/i],
      }, 13000);
    case "aea-forthcoming-html":
      return extractHtmlByPatterns(item, {
        include: [/\/articles\?id=10\.1257\/aer\./i],
        exclude: [/front matter/i, /full_issue\.php/i],
      }, 13000);
    case "oup-advance-html":
      return extractHtmlByPatterns(item, {
        include: [/\/(qje|restud)\/(advance-article|article)\/doi\/10\.1093\//i, /\/doi\/10\.1093\//i],
        exclude: [/login|register|search/i],
      }, 13000);
    case "afa-forthcoming-doi":
      return extractAfaForthcomingDoi(item);
    case "asq-sage-links":
      return extractHtmlByPatterns(item, {
        include: [/journals\.sagepub\.com\/doi\/(full|abs)\/10\.1177\//i],
      }, 13000);
    default:
      return extractHtmlByPatterns(item, {
        include: [/article|abstract|paper|doi|content|detail/i],
        exclude: [/login|admin|editor/i],
      });
  }
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
  const response = await fetchText(feed.feed_url, 10000);
  const allArticles = response.ok ? parseXmlFeed(response.text, response.finalUrl) : [];
  const articles = allArticles.filter((article) => looksLikeArticleTitle(article.title) && !isNonArticleTitle(article.title)).slice(0, 8);
  return {
    type: "direct_rss",
    journal_id: feed.journal_id,
    journal_name: feed.journal_name,
    source_url: feed.feed_url,
    probe_url: feed.feed_url,
    extraction_rule: feed.parser_profile,
    status: response.status,
    content_type: response.contentType,
    transport: response.transport,
    fetch_ms: response.ms,
    ok: articles.length > 0,
    usable_as_data_source: articles.length > 0,
    article_count: articles.length,
    candidate_count: allArticles.length,
    samples: articles.slice(0, 3),
    notes: allArticles.length !== articles.length ? [`filtered_non_article:${allArticles.length - articles.length}`] : [],
    error: response.error || response.fetch_error || "",
  };
}

async function testAdapterSource(item) {
  const profile = profileById.get(item.platform_id);
  try {
    const extraction = await extractAdapterArticles(item);
    const articles = extraction.articles.filter((article) => looksLikeArticleTitle(article.title) && !isNonArticleTitle(article.title)).slice(0, 8);
    return {
      type: "adapter_source",
      journal_id: item.journal_id,
      journal_name: item.journal_name,
      platform_id: item.platform_id,
      platform_name: profile?.name || item.platform_id,
      source_url: item.source_url,
      probe_url: extraction.probe_url || item.source_url,
      extraction_rule: item.adapter_rule?.kind || item.platform_id,
      status: extraction.response?.status || "ERR",
      content_type: extraction.response?.contentType || "",
      transport: extraction.response?.transport || "",
      fetch_ms: extraction.response?.ms || 0,
      ok: articles.length > 0,
      usable_as_data_source: articles.length > 0,
      article_count: articles.length,
      candidate_count: extraction.candidate_count || articles.length,
      samples: articles.slice(0, 3),
      notes: extraction.notes || [],
      error: extraction.response?.error || extraction.response?.fetch_error || "",
    };
  } catch (error) {
    return {
      type: "adapter_source",
      journal_id: item.journal_id,
      journal_name: item.journal_name,
      platform_id: item.platform_id,
      platform_name: profile?.name || item.platform_id,
      source_url: item.source_url,
      probe_url: item.source_url,
      extraction_rule: item.adapter_rule?.kind || item.platform_id,
      status: "ERR",
      content_type: "",
      transport: "",
      fetch_ms: 0,
      ok: false,
      usable_as_data_source: false,
      article_count: 0,
      candidate_count: 0,
      samples: [],
      notes: ["adapter_exception"],
      error: error.message,
    };
  }
}

const directResults = await runPool(registry.direct_article_feeds, 4, testDirectFeed);
const adapterResults = await runPool(registry.adapter_queue, 4, testAdapterSource);
const allResults = [...directResults, ...adapterResults];

const summary = {
  checked_at: new Date().toISOString(),
  direct_feeds_total: directResults.length,
  direct_feeds_ok: directResults.filter((item) => item.usable_as_data_source).length,
  adapter_sources_total: adapterResults.length,
  adapter_sources_article_ready: adapterResults.filter((item) => item.usable_as_data_source).length,
  adapter_sources_blocked: adapterResults.filter((item) => !item.usable_as_data_source).length,
  article_ready_total: allResults.filter((item) => item.usable_as_data_source).length,
};

const result = { summary, results: allResults };
await writeFile(new URL("../data/fetch-smoke-results.json", import.meta.url), JSON.stringify(result, null, 2));

console.log(JSON.stringify(summary, null, 2));
for (const item of allResults) {
  const mark = item.usable_as_data_source ? "READY" : "BLOCKED";
  const sample = item.samples[0]?.title || item.notes?.join(",") || item.error || item.content_type || "";
  console.log(`${mark.padEnd(8)} ${item.journal_id.padEnd(4)} ${item.journal_name} | ${String(item.article_count).padStart(2)} | ${item.extraction_rule} | ${sample}`);
}
