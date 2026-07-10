function decodeHtml(value = "") {
  const named = {
    amp: "&",
    apos: "'",
    gt: ">",
    lt: "<",
    nbsp: " ",
    quot: "\"",
  };

  return String(value)
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&([a-z]+);/gi, (match, name) => named[name.toLowerCase()] || match);
}

function stripTags(value = "") {
  return decodeHtml(String(value).replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
}

function normalizeUrl(value = "", baseUrl = "") {
  try {
    return new URL(decodeHtml(value), baseUrl).toString();
  } catch {
    return "";
  }
}

function cleanAuthors(value = "") {
  return stripTags(value)
    .split(/[;；]/)
    .map((name) => name.replace(/\[[^\]]*\]/g, "").trim())
    .filter(Boolean)
    .join("; ");
}

function dedupeById(articles) {
  const seen = new Map();
  for (const article of articles) {
    if (article.id && !seen.has(article.id)) seen.set(article.id, article);
  }
  return [...seen.values()];
}

export function compactArticleTitle(value = "") {
  return stripTags(value)
    .normalize("NFKC")
    .replace(/[：﹕]/g, ":")
    .replace(/[‐‑‒–—]/g, "-")
    .replace(/\s+/g, "")
    .trim();
}

function articleIdFromUrl(url = "") {
  try {
    return new URL(url).searchParams.get("id") || "";
  } catch {
    return String(url).match(/[?&]id=([^&#]+)/i)?.[1] || "";
  }
}

function articleIdFromHandleCall(context = "") {
  const handleCall = context.match(/(?:ViewHandleCount|AddHandleCount)\(([\s\S]*?)\)/i)?.[1] || "";
  return parseSingleQuotedArgs(handleCall).find((arg) => /^[A-Z0-9]*20\d{2}\d{3,}$/i.test(arg)) || "";
}

export function issueDateFromNcpssdArticleId(value = "") {
  const match = String(value || "").match(/[A-Z]+(20\d{2})(\d{3})\d+/i);
  if (!match) return "";
  const issue = Number(match[2]);
  return issue >= 1 && issue <= 12 ? `${match[1]}-${String(issue).padStart(2, "0")}` : "";
}

function parseSingleQuotedArgs(call = "") {
  return [...call.matchAll(/'([^']*)'/g)].map((match) => decodeHtml(match[1]));
}

function authorsFromContext(context = "", title = "") {
  const handleCall = context.match(/(?:ViewHandleCount|AddHandleCount)\(([\s\S]*?)\)/i)?.[1] || "";
  const args = parseSingleQuotedArgs(handleCall);
  const titleKey = compactArticleTitle(title);
  const titleIndex = args.findIndex((arg) => compactArticleTitle(arg) === titleKey);
  return titleIndex >= 0 ? cleanAuthors(args[titleIndex + 1] || "") : "";
}

export function parseNcpssdIssueArticles(html = "", baseUrl = "https://www.ncpssd.org/") {
  const detailRegex = /<a\b(?=[^>]*openDetail\(\s*['"]([^'"]*\/Literature\/(?:secure\/)?articleinfo\?[^'"]+)['"](?:\s*,[^)]*)?\))[^>]*>[\s\S]*?<\/a>/gi;
  const matches = [...String(html).matchAll(detailRegex)];
  const articles = matches.map((match, index) => {
    const anchorHtml = match[0];
    const openingTag = anchorHtml.match(/^<a\b[^>]*>/i)?.[0] || "";
    const titleAttr = openingTag.match(/\btitle=(["'])([\s\S]*?)\1/i)?.[2] || "";
    const title = stripTags(titleAttr || anchorHtml);
    const officialUrl = normalizeUrl(match[1], baseUrl);
    const nextIndex = matches[index + 1]?.index ?? Math.min(String(html).length, match.index + 2400);
    const context = String(html).slice(match.index, nextIndex);
    const readerPath = context.match(/['"]([^'"]*\/Literature\/readurl\?id=[^'"]+)['"]/i)?.[1] || "";
    const readerUrl = normalizeUrl(readerPath, baseUrl);
    const id = articleIdFromUrl(officialUrl) || articleIdFromUrl(readerUrl) || articleIdFromHandleCall(context);
    const issueDate = issueDateFromNcpssdArticleId(id);

    return {
      id,
      title,
      official_url: officialUrl,
      reader_url: readerUrl,
      authors: authorsFromContext(context, title),
      issue_date: issueDate,
      date_source: issueDate ? "ncpssd_article_id" : "",
    };
  }).filter((article) => article.id && article.title && article.official_url);

  return dedupeById(articles);
}

export function resolveNcpssdArticle(article = {}, ncpssdArticles = []) {
  const target = compactArticleTitle(article.title || "");
  if (!target) return null;
  return ncpssdArticles.find((candidate) => compactArticleTitle(candidate.title) === target) || null;
}

/**
 * Historical official-link resolution is deliberately stricter than the
 * discovery adapters: a candidate must be title matched and hosted by one of
 * the two sources we can treat as an official article entry.  In particular,
 * this prevents Macrodatas/CNKI directory URLs from becoming frontend links.
 */
export function isAllowedHistoricalOfficialUrl(value = "") {
  try {
    const hostname = new URL(value).hostname.toLowerCase();
    return hostname === "ncpssd.cn"
      || hostname.endsWith(".ncpssd.cn")
      || hostname === "nbr.nankai.edu.cn";
  } catch {
    return false;
  }
}

export function titleLevelOfficialMatch(article = {}, candidates = []) {
  const target = compactArticleTitle(article.title || "");
  if (!target) return null;
  const allowed = candidates.filter((candidate) => {
    const url = candidate.official_url || candidate.url || candidate.href || "";
    return isAllowedHistoricalOfficialUrl(url);
  });
  const exact = allowed.find((candidate) => compactArticleTitle(candidate.title || candidate.text || "") === target);
  if (exact) return { ...exact, title_match_kind: "exact" };

  const comparisonText = (value) => compactArticleTitle(value).replace(/[^\p{L}\p{N}]+/gu, "");
  const diceScore = (left, right) => {
    const a = [...comparisonText(left)];
    const b = [...comparisonText(right)];
    if (a.length < 2 || b.length < 2) return 0;
    const counts = new Map();
    for (let index = 0; index < a.length - 1; index += 1) {
      const pair = `${a[index]}${a[index + 1]}`;
      counts.set(pair, (counts.get(pair) || 0) + 1);
    }
    let overlap = 0;
    for (let index = 0; index < b.length - 1; index += 1) {
      const pair = `${b[index]}${b[index + 1]}`;
      if (!counts.get(pair)) continue;
      overlap += 1;
      counts.set(pair, counts.get(pair) - 1);
    }
    return (2 * overlap) / (a.length + b.length - 2);
  };
  const ranked = allowed
    .map((candidate) => ({ candidate, score: diceScore(article.title || "", candidate.title || candidate.text || "") }))
    .sort((left, right) => right.score - left.score);
  const best = ranked[0];
  const runnerUp = ranked[1];
  if (!best || best.score < 0.8 || (runnerUp && best.score - runnerUp.score < 0.1)) return null;
  return { ...best.candidate, title_match_kind: "unique_fuzzy", title_match_score: best.score };
}

export function resolveNankaiHistoricalOfficialArticle(article = {}, candidates = []) {
  const candidate = titleLevelOfficialMatch(article, candidates);
  if (!candidate) return null;
  const officialUrl = candidate.official_url || candidate.url || candidate.href || "";
  const source = new URL(officialUrl).hostname.toLowerCase().endsWith(".ncpssd.cn")
    || new URL(officialUrl).hostname.toLowerCase() === "ncpssd.cn"
    ? "ncpssd"
    : "nbr.nankai.edu.cn";
  return {
    ...article,
    official_url: officialUrl,
    url: officialUrl,
    pdf_url: candidate.pdf_url || article.pdf_url || "",
    reader_url: candidate.reader_url || article.reader_url || "",
    link_status: candidate.pdf_url ? "official_pdf" : "official_detail",
    link_note: candidate.title_match_kind === "unique_fuzzy"
      ? "unique_fuzzy_historical_title_match"
      : "title_level_historical_match",
    official_source: source,
  };
}

export function resolveNcpssdOfficialArticle(article = {}, ncpssdArticles = []) {
  const official = resolveNcpssdArticle(article, ncpssdArticles);
  if (!official) return null;
  return {
    ...article,
    official_url: official.official_url,
    reader_url: official.reader_url,
    authors: article.authors || official.authors,
    issue_date: article.issue_date || official.issue_date || "",
    date_source: article.date_source || official.date_source || "",
    official_source: "ncpssd",
  };
}

function padIssuePart(value = "", width) {
  return String(value || "").replace(/\D/g, "").padStart(width, "0");
}

function cnkiCjfdFilename(resolver = {}, context = {}, index = 0) {
  const journalCode = String(resolver.journal_code || "").trim().toUpperCase();
  const year = padIssuePart(context.year, 4);
  const issue = padIssuePart(context.issue, 2);
  const articleNo = padIssuePart(Number(resolver.start_index || 1) + index, 3);
  return journalCode && year && issue && articleNo ? `${journalCode}${year}${issue}${articleNo}` : "";
}

export function resolveCnkiSequentialArticles(articles = [], resolver = {}, context = {}) {
  if (!resolver.allow_unverified_sequence) return articles;

  const template = resolver.url_template || "https://kns.cnki.net/kcms/detail/detail.aspx?dbcode=CJFD&filename={filename}";
  return articles.map((article, index) => {
    if (article.official_url && !resolver.overwrite) return article;
    const filename = cnkiCjfdFilename(resolver, context, index);
    if (!filename) return article;
    return {
      ...article,
      official_url: template.replace(/\{filename\}/g, filename),
      official_source: resolver.official_source || "cnki",
      access_model: resolver.access_model || "paid",
      cnki_filename: filename,
    };
  });
}
