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
  const detailRegex = /<a\b(?=[^>]*openDetail\(\s*['"]([^'"]*\/Literature\/articleinfo\?[^'"]+)['"]\s*\))[^>]*>[\s\S]*?<\/a>/gi;
  const matches = [...String(html).matchAll(detailRegex)];
  const articles = matches.map((match, index) => {
    const anchorHtml = match[0];
    const openingTag = anchorHtml.match(/^<a\b[^>]*>/i)?.[0] || "";
    const titleAttr = openingTag.match(/\btitle=(["'])([\s\S]*?)\1/i)?.[2] || "";
    const title = stripTags(titleAttr || anchorHtml);
    const officialUrl = normalizeUrl(match[1], baseUrl);
    const id = articleIdFromUrl(officialUrl);
    const nextIndex = matches[index + 1]?.index ?? Math.min(String(html).length, match.index + 2400);
    const context = String(html).slice(match.index, nextIndex);
    const readerPath = context.match(/['"]([^'"]*\/Literature\/readurl\?id=[^'"]+)['"]/i)?.[1] || "";

    return {
      id,
      title,
      official_url: officialUrl,
      reader_url: normalizeUrl(readerPath, baseUrl),
      authors: authorsFromContext(context, title),
    };
  }).filter((article) => article.id && article.title && article.official_url);

  return dedupeById(articles);
}

export function resolveNcpssdArticle(article = {}, ncpssdArticles = []) {
  const target = compactArticleTitle(article.title || "");
  if (!target) return null;
  return ncpssdArticles.find((candidate) => compactArticleTitle(candidate.title) === target) || null;
}
