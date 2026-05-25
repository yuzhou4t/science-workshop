import { execFile } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import vm from "node:vm";
import { promisify } from "node:util";

import { extractDateHints } from "./date-enhancement-lib.mjs";
import { addDays, buildRecentWorkflow, dateOnly } from "./recent-workflow-lib.mjs";

const execFileAsync = promisify(execFile);
const registryPath = new URL("../data/adapter-profiles.json", import.meta.url);
const registry = JSON.parse(await readFile(registryPath, "utf8"));
const profileById = new Map(registry.platform_profiles.map((profile) => [profile.id, profile]));

function parseCliOptions(argv) {
  const options = { workflow: false, articleLimit: 8, recentDays: 30 };
  for (const arg of argv) {
    if (arg === "--workflow") options.workflow = true;
    else if (arg === "--ignore-state") {
      options.workflow = true;
      options.ignoreState = true;
    } else if (arg === "--baseline") {
      options.workflow = true;
      options.baseline = true;
    }
    else if (arg.startsWith("--since=")) {
      options.workflow = true;
      options.since = arg.slice("--since=".length);
    } else if (arg.startsWith("--until=")) {
      options.workflow = true;
      options.until = arg.slice("--until=".length);
    } else if (arg.startsWith("--recent-days=")) {
      options.workflow = true;
      options.recentDays = Number(arg.slice("--recent-days=".length));
    }
  }

  options.until ||= dateOnly(new Date());
  options.since ||= addDays(options.until, -options.recentDays);
  if (options.workflow) options.articleLimit = 50;

  for (const [name, value] of [["since", options.since], ["until", options.until]]) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`Invalid --${name} date: ${value}. Use YYYY-MM-DD.`);
  }
  if (options.since > options.until) throw new Error(`Invalid window: --since ${options.since} is after --until ${options.until}.`);
  return options;
}

async function readJsonIfExists(url) {
  try {
    return JSON.parse(await readFile(url, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return {};
    throw error;
  }
}

const cliOptions = parseCliOptions(process.argv.slice(2));

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
    if (!parsed.hash.startsWith("#/issueDetail") && !/^#directory-\d+$/i.test(parsed.hash)) parsed.hash = "";
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
    const date = stripTags(block.match(/<(?:[\w.-]+:)?(?:pubDate|updated|published|date|publicationDate)[^>]*>([\s\S]*?)<\/(?:[\w.-]+:)?(?:pubDate|updated|published|date|publicationDate)>/i)?.[1] || "");
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
      context: stripTags(text.slice(Math.max(0, match.index - 700), Math.min(text.length, match.index + match[0].length + 700))),
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

    const dateHints = extractDateHints({ url, context: anchor.context });
    articles.push({ title: anchor.title, url, date: dateHints.published_at || "", ...dateHints });
  }
  return dedupeArticles(articles);
}

function mergeDateHints(article, hints = {}) {
  if (!Object.keys(hints).length) return article;
  const merged = {
    ...article,
    ...hints,
    published_at: article.published_at || hints.published_at || "",
    issue_date: article.issue_date || hints.issue_date || "",
    date_source: article.date_source || hints.date_source || "",
  };
  if (!merged.date && merged.published_at) merged.date = merged.published_at;
  else if (!merged.date && merged.issue_date) merged.date = merged.issue_date;
  return merged;
}

function needsDetailDate(article) {
  return !article.published_at && !article.issue_date && !article.date && /^https?:\/\//i.test(article.url || "");
}

async function enrichArticlesWithDetailDates(articles, options = {}) {
  const limit = options.limit || 20;
  const timeoutMs = options.timeoutMs || 9000;
  const enriched = [];
  let checked = 0;
  for (const article of articles) {
    if (!needsDetailDate(article) || checked >= limit) {
      enriched.push(article);
      continue;
    }
    checked += 1;
    try {
      const response = await fetchText(article.url, timeoutMs);
      const hints = response.ok ? extractDateHints({ url: response.finalUrl || article.url, context: response.text }) : {};
      enriched.push(mergeDateHints(article, hints));
    } catch {
      enriched.push(article);
    }
  }
  return enriched;
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
    || /^american finance association$/i.test(title)
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

function compactText(value = "") {
  return stripTags(value).replace(/\s+/g, "");
}

function issueSortKey(value = "") {
  const compact = compactText(value);
  const match = compact.match(/(20\d{2})年第?(\d{1,2})期/);
  return match ? Number(match[1]) * 100 + Number(match[2]) : 0;
}

function datePartsToIso(dateParts) {
  const parts = dateParts?.["date-parts"]?.[0] || [];
  if (!parts.length) return "";
  const [year, month, day] = parts;
  if (!year) return "";
  if (!month) return String(year);
  if (!day) return `${year}-${String(month).padStart(2, "0")}`;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function doiToUrl(doi = "") {
  const clean = doi.replace(/^https?:\/\/(dx\.)?doi\.org\//i, "").trim();
  return clean ? `https://doi.org/${clean}` : "";
}

function matchesDoiPrefix(doi = "", prefixes = []) {
  if (!prefixes.length) return true;
  const normalized = doi.replace(/^https?:\/\/(dx\.)?doi\.org\//i, "").toLowerCase();
  return prefixes.some((prefix) => normalized.startsWith(String(prefix).toLowerCase()));
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

async function extractHtmlByPatterns(item, patternOptions, timeoutMs = 11000, options = {}) {
  const response = await fetchText(item.source_url, timeoutMs);
  let articles = response.ok ? parseAnchorsMatching(response.text, response.finalUrl, patternOptions) : [];
  if (response.ok && options.sourceDateHints) {
    const sourceHints = extractDateHints({ url: response.finalUrl, context: response.text });
    articles = articles.map((article) => mergeDateHints(article, sourceHints));
  }
  if (response.ok && options.detailDateHints) {
    articles = await enrichArticlesWithDetailDates(articles, options.detailDateHints);
  }
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

async function extractOpenMetadataWorks(item) {
  const rule = item.adapter_rule || {};
  const issns = rule.issns || [];
  const services = rule.fallback_services || ["crossref", "openalex"];
  const doiPrefixes = rule.doi_prefixes || (rule.doi_prefix ? [rule.doi_prefix] : []);
  const articles = [];
  const notes = [];
  let firstResponse = null;
  let selectedProbeUrl = item.source_url;
  let candidateCount = 0;

  const maybeReturn = (service, probeUrl, response) => {
    const usable = dedupeArticles(articles).filter((article) => looksLikeArticleTitle(article.title) && !isNonArticleTitle(article.title));
    if (!usable.length) return null;
    return {
      response,
      probe_url: probeUrl,
      articles: usable,
      candidate_count: candidateCount,
      notes: [`metadata_service:${service}`, `metadata_candidates:${candidateCount}`],
    };
  };

  for (const service of services) {
    for (const issn of issns) {
      if (service === "crossref") {
        const probeUrl = `https://api.crossref.org/journals/${encodeURIComponent(issn)}/works?filter=type:journal-article&sort=published&order=desc&rows=12`;
        const response = await fetchText(probeUrl, 15000, { Accept: "application/json,*/*" });
        firstResponse ||= response;
        selectedProbeUrl = probeUrl;
        if (!response.ok) {
          notes.push(`crossref_${issn}:status_${response.status}`);
          continue;
        }
        try {
          const payload = JSON.parse(response.text);
          const works = payload.message?.items || [];
          candidateCount += works.length;
          for (const work of works) {
            const title = stripTags(Array.isArray(work.title) ? work.title[0] : work.title || "");
            const doi = work.DOI || "";
            if (!title || !matchesDoiPrefix(doi, doiPrefixes)) continue;
            articles.push({
              title,
              url: doiToUrl(doi) || work.URL || item.source_url,
              date: datePartsToIso(work["published-online"] || work["published-print"] || work.published || work.created),
              authors: (work.author || []).slice(0, 5).map((author) => [author.given, author.family].filter(Boolean).join(" ")).filter(Boolean).join(", "),
            });
          }
        } catch (error) {
          notes.push(`crossref_parse_failed:${error.message}`);
        }

        const ready = maybeReturn("crossref", probeUrl, response);
        if (ready) return ready;
      }

      if (service === "openalex") {
        const probeUrl = `https://api.openalex.org/works?filter=primary_location.source.issn:${encodeURIComponent(issn)}&sort=publication_date:desc&per-page=12`;
        const response = await fetchText(probeUrl, 15000, { Accept: "application/json,*/*" });
        firstResponse ||= response;
        selectedProbeUrl = probeUrl;
        if (!response.ok) {
          notes.push(`openalex_${issn}:status_${response.status}`);
          continue;
        }
        try {
          const payload = JSON.parse(response.text);
          const works = payload.results || [];
          candidateCount += works.length;
          for (const work of works) {
            const doi = work.doi || "";
            if (!work.display_name || !matchesDoiPrefix(doi, doiPrefixes)) continue;
            articles.push({
              title: stripTags(work.display_name),
              url: doiToUrl(doi) || work.primary_location?.landing_page_url || work.id || item.source_url,
              date: work.publication_date || "",
              authors: (work.authorships || []).slice(0, 5).map((author) => author.author?.display_name).filter(Boolean).join(", "),
            });
          }
        } catch (error) {
          notes.push(`openalex_parse_failed:${error.message}`);
        }

        const ready = maybeReturn("openalex", probeUrl, response);
        if (ready) return ready;
      }
    }
  }

  return {
    response: firstResponse,
    probe_url: selectedProbeUrl,
    articles: [],
    candidate_count: candidateCount,
    notes: notes.length ? notes : ["metadata_no_articles"],
  };
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

async function extractAscCurrentIssueHtml(item) {
  const now = new Date();
  const currentYear = now.getFullYear();
  const yearSpan = item.adapter_rule?.year_span || 2;
  let lastResponse = null;
  const notes = [];

  for (let year = currentYear; year > currentYear - yearSpan; year -= 1) {
    for (let issue = 12; issue >= 1; issue -= 1) {
      const probeUrl = `${item.source_url}?issue=${issue}&year=${year}`;
      const response = await fetchText(probeUrl, 12000);
      lastResponse = response;
      if (!response.ok) continue;

      const articles = parseAnchorsMatching(response.text, response.finalUrl, {
        include: [/\/AccountingResearch\/BrowseDetail\.aspx/i, /BrowseDetail\.aspx\?/i],
        exclude: [/Login|User|Download/i],
      }).map((article) => ({
        ...article,
        issue_date: article.issue_date || `${year}-${String(issue).padStart(2, "0")}`,
        date_source: article.date_source || "issue_loop",
      }));
      if (articles.length) {
        return {
          response,
          probe_url: probeUrl,
          articles,
          candidate_count: articles.length,
          notes: [`issue:${year}-${String(issue).padStart(2, "0")}`],
        };
      }
    }
  }

  notes.push("published_issue_not_found");
  return { response: lastResponse, probe_url: item.source_url, articles: [], candidate_count: 0, notes };
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

function parseNuxtPayload(html) {
  const match = html.match(/<script>window\.__NUXT__=([\s\S]*?)<\/script>/);
  if (!match) return null;
  const context = { window: {} };
  vm.runInNewContext(`window.__NUXT__=${match[1].replace(/;$/, "")}`, context, { timeout: 1000 });
  return context.window.__NUXT__;
}

function flattenCatalogRecords(records = []) {
  const articles = [];
  const walk = (entries) => {
    for (const entry of entries || []) {
      if (entry?.children?.length) walk(entry.children);
      else if (entry?.title || entry?.name) articles.push(entry);
    }
  };
  walk(records);
  return articles;
}

async function extractCqvipJournalHtml(item) {
  const response = await fetchText(item.source_url, 16000);
  const notes = [];
  if (!response.ok) return { response, probe_url: item.source_url, articles: [], candidate_count: 0, notes };

  let payload = null;
  try {
    payload = parseNuxtPayload(response.text);
  } catch (error) {
    notes.push(`nuxt_parse_failed:${error.message}`);
  }

  const fetchData = payload ? Object.values(payload.fetch || {})[0] : null;
  const records = fetchData?.catalog?.records || [];
  const issueLabel = stripTags(response.text).match(/20\d{2}年\d{1,2}期/)?.[0] || "";
  const issueDate = issueLabel.replace(/年(\d{1,2})期/, (_, issue) => `-${String(issue).padStart(2, "0")}`);
  const articles = flattenCatalogRecords(records).map((row) => {
    const signInfo = row.signInfo || {};
    const url = new URL(`/doc/journal/${row.id || signInfo.resourceId}`, response.finalUrl);
    for (const key of ["sign", "expireTime", "resourceId", "type"]) {
      if (signInfo[key]) url.searchParams.set(key, signInfo[key]);
    }
    return {
      title: stripTags(row.title || row.name || ""),
      url: cleanArticleUrl(url.toString()),
      date: issueDate,
      authors: (row.authorInfo || []).map((author) => author.name).filter(Boolean).join(", "),
    };
  }).filter((article) => looksLikeArticleTitle(article.title));

  if (!articles.length) notes.push("catalog_records_not_found");
  return {
    response,
    probe_url: item.source_url,
    articles: dedupeArticles(articles),
    candidate_count: fetchData?.catalog?.count || articles.length,
    notes: issueLabel ? [`issue:${issueLabel}`, "fallback_source:cqvip"] : ["fallback_source:cqvip", ...notes],
  };
}

function expandMacrodatasSearchTerms(rule) {
  const currentYear = new Date().getFullYear();
  const terms = rule.search_terms?.length ? rule.search_terms : [`${rule.journal_title} {year}年第`];
  return terms.map((term) => term
    .replace(/\{journal\}/g, rule.journal_title || "")
    .replace(/\{year\}/g, String(currentYear))
    .replace(/\{previous_year\}/g, String(currentYear - 1)));
}

function parseMacrodatasIssueLinks(html, baseUrl, journalTitle) {
  const exactJournal = `《${journalTitle}》`;
  return dedupeArticles(parseRawAnchors(html, baseUrl)
    .filter((anchor) => /\/article\/\d+/i.test(anchor.url))
    .filter((anchor) => compactText(anchor.title).includes(compactText(exactJournal)))
    .filter((anchor) => issueSortKey(anchor.title) > 0)
    .map((anchor) => ({
      title: anchor.title,
      url: cleanArticleUrl(anchor.url),
      date: "",
      issue_key: issueSortKey(anchor.title),
    })))
    .sort((a, b) => b.issue_key - a.issue_key);
}

function parseMacrodatasDirectoryArticles(html, pageUrl) {
  const releaseDate = html.match(/document\.write\("([^"]{10})/)?.[1] || "";
  const articles = [];
  const entryRegex = /<p[^>]*>\s*(\d{2})\s+([\s\S]*?)<\/p>\s*<p[^>]*style=["'][^"']*color:[^"']*["'][^>]*>([\s\S]*?)<\/p>/gi;
  for (const match of html.matchAll(entryRegex)) {
    const title = stripTags(match[2]);
    if (!looksLikeArticleTitle(title)) continue;
    articles.push({
      title,
      url: `${cleanArticleUrl(pageUrl)}#directory-${match[1]}`,
      date: releaseDate,
      authors: stripTags(match[3]),
    });
  }

  if (articles.length) return dedupeArticles(articles);

  const text = stripTags(html);
  let directory = text.slice(Math.max(0, text.indexOf("目录")));
  const firstItemIndex = directory.search(/\b01\s+/);
  if (firstItemIndex >= 0) directory = directory.slice(firstItemIndex);
  const firstDetailIndex = directory.search(/#\s*01\s*#/);
  if (firstDetailIndex > 0) directory = directory.slice(0, firstDetailIndex);
  const fallbackRegex = /(?:^|\s)(\d{2})\s+(.+?)(?=\s+\d{2}\s+|$)/g;
  for (const match of directory.matchAll(fallbackRegex)) {
    const title = match[2].trim();
    if (!looksLikeArticleTitle(title)) continue;
    articles.push({
      title,
      url: `${cleanArticleUrl(pageUrl)}#directory-${match[1]}`,
      date: releaseDate,
    });
  }
  return dedupeArticles(articles);
}

async function extractMacrodatasIssueList(item) {
  const rule = item.adapter_rule || {};
  const listBaseUrl = rule.list_base_url || "https://www.macrodatas.cn/list/1/0/0/";
  const discoveryUrls = [
    ...expandMacrodatasSearchTerms(rule).map((term) => `${listBaseUrl}${encodeURIComponent(term)}`),
    ...(rule.discovery_urls || []),
  ];
  const notes = ["fallback_source:macrodatas"];
  let lastResponse = null;
  let issueLinks = [];

  for (const discoveryUrl of discoveryUrls) {
    const response = await fetchText(discoveryUrl, 15000);
    lastResponse = response;
    if (!response.ok) {
      notes.push(`discovery_status:${response.status}`);
      continue;
    }
    issueLinks = parseMacrodatasIssueLinks(response.text, response.finalUrl, rule.journal_title || item.journal_name);
    if (issueLinks.length) break;
  }

  if (!issueLinks.length) {
    notes.push("issue_link_not_found");
    return { response: lastResponse, probe_url: discoveryUrls[0] || item.source_url, articles: [], candidate_count: 0, notes };
  }

  const selectedIssue = issueLinks[0];
  const issueResponse = await fetchText(selectedIssue.url, 15000);
  const articles = issueResponse.ok ? parseMacrodatasDirectoryArticles(issueResponse.text, issueResponse.finalUrl) : [];
  if (!articles.length) notes.push("directory_not_found");

  return {
    response: issueResponse,
    probe_url: selectedIssue.url,
    articles,
    candidate_count: issueLinks.length,
    notes: [...notes, `issue_candidates:${issueLinks.length}`, `issue:${compactText(selectedIssue.title).match(/20\d{2}年第?\d{1,2}期/)?.[0] || selectedIssue.title}`],
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
      }, 11000, { detailDateHints: { limit: 30, timeoutMs: 10000 } });
    case "cnki-captcha-check":
      return extractCnkiCaptchaCheck(item);
    case "macrodatas-issue-list":
      return extractMacrodatasIssueList(item);
    case "cnki-portal-paper":
      return extractHtmlByPatterns(item, {
        include: [/\/portal\/journal\/portal\/client\/paper\/[a-z0-9-]+/i],
        exclude: [/\/editor\b/i, /admin/i, /login/i],
      }, 13000, { detailDateHints: { limit: 20, timeoutMs: 11000 } });
    case "nankai-protected-html":
      return extractNankaiProtectedHtml(item);
    case "jmsc-issue-html":
      return extractJmscIssueHtml(item);
    case "cqvip-journal-html":
      return extractCqvipJournalHtml(item);
    case "asc-current-issue-html":
      return extractAscCurrentIssueHtml(item);
    case "asc-issue-list":
      return extractAscIssueList(item);
    case "open-metadata-works":
      return extractOpenMetadataWorks(item);
    case "aaahq-issue-html":
      return extractHtmlByPatterns(item, {
        include: [/\/accounting-review\/article\//i, /\/doi\/10\.2308\//i],
        exclude: [/login|register|search/i],
      }, 13000);
    case "aea-forthcoming-html":
      return extractHtmlByPatterns(item, {
        include: [/\/articles\?id=10\.1257\/aer\./i],
        exclude: [/front matter/i, /full_issue\.php/i],
      }, 13000, { sourceDateHints: true });
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
      }, 13000, { sourceDateHints: true });
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
  const filteredArticles = allArticles.filter((article) => looksLikeArticleTitle(article.title) && !isNonArticleTitle(article.title));
  const articles = filteredArticles.slice(0, cliOptions.articleLimit);
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
    articles,
    samples: articles.slice(0, 3),
    notes: allArticles.length !== filteredArticles.length ? [`filtered_non_article:${allArticles.length - filteredArticles.length}`] : [],
    error: response.error || response.fetch_error || "",
  };
}

async function testAdapterSource(item) {
  const profile = profileById.get(item.platform_id);
  try {
    const extraction = await extractAdapterArticles(item);
    const filteredArticles = extraction.articles.filter((article) => looksLikeArticleTitle(article.title) && !isNonArticleTitle(article.title));
    const articles = filteredArticles.slice(0, cliOptions.articleLimit);
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
      articles,
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

let workflow = null;
if (cliOptions.workflow) {
  const previousState = cliOptions.ignoreState ? {} : await readJsonIfExists(new URL("../data/source-state.json", import.meta.url));
  workflow = buildRecentWorkflow(allResults, {
    since: cliOptions.since,
    until: cliOptions.until,
    checkedAt: summary.checked_at,
    previousState,
    baseline: cliOptions.baseline,
  });
  const recentPath = new URL(`../data/recent-articles-${cliOptions.since}_${cliOptions.until}.json`, import.meta.url);
  const statePath = new URL("../data/source-state.json", import.meta.url);
  await writeFile(recentPath, JSON.stringify(workflow, null, 2));
  await writeFile(statePath, JSON.stringify(workflow.source_state, null, 2));
}

console.log(JSON.stringify(summary, null, 2));
if (workflow) {
  console.log(JSON.stringify({
    workflow: "recent_articles",
    output: `data/recent-articles-${cliOptions.since}_${cliOptions.until}.json`,
    state: "data/source-state.json",
    baseline: Boolean(cliOptions.baseline),
    ...workflow.summary,
  }, null, 2));
}
for (const item of allResults) {
  const mark = item.usable_as_data_source ? "READY" : "BLOCKED";
  const sample = item.samples[0]?.title || item.notes?.join(",") || item.error || item.content_type || "";
  console.log(`${mark.padEnd(8)} ${item.journal_id.padEnd(4)} ${item.journal_name} | ${String(item.article_count).padStart(2)} | ${item.extraction_rule} | ${sample}`);
}
