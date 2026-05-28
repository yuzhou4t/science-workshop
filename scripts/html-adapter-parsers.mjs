function decodeEntities(value = "") {
  return String(value)
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
  return decodeEntities(String(value)
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeUrl(href, base) {
  try {
    return new URL(decodeEntities(href), base).toString();
  } catch {
    return "";
  }
}

function normalizeAuthors(value = "") {
  return stripTags(value)
    .replace(/[，、；;]/g, ",")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .join(", ");
}

function partialAuthors(value = "") {
  const cleaned = stripTags(value).replace(/(?:\.\.\.|…)+/g, "").replace(/[，,]\s*$/g, "").trim();
  return cleaned ? `${normalizeAuthors(cleaned)} 等` : "";
}

function issueDate(year, issue) {
  return year && issue ? `${year}-${String(issue).padStart(2, "0")}` : "";
}

export function parseCieCurrentArticles(html = "", baseUrl = "") {
  const articles = [];
  const blocks = [...String(html).matchAll(/<table\b[^>]*>[\s\S]*?<\/table>/gi)].map((match) => match[0]);
  for (const block of blocks) {
    const link = block.match(/<a\b[^>]*href=["']([^"']*\/Magazine\/Show\?id=\d+[^"']*)["'][^>]*>([\s\S]*?)<\/a>/i);
    if (!link) continue;
    const authorMatch = block.match(/<\/a>\s*<span\b[^>]*>([\s\S]*?)<\/span>/i);
    const issueMatch = stripTags(block).match(/(20\d{2})\s*年\s*,?\s*第\s*(\d{1,2})\s*期/i);
    articles.push({
      title: stripTags(link[2]),
      url: normalizeUrl(link[1], baseUrl),
      authors: normalizeAuthors(authorMatch?.[1] || ""),
      author_source: authorMatch ? "list_author" : "",
      issue_date: issueDate(issueMatch?.[1], issueMatch?.[2]),
      date_source: issueMatch ? "context_issue" : "",
    });
  }
  return articles.filter((article) => article.title && article.url);
}

export function parseAscIssueListArticles(html = "", baseUrl = "", issueDateText = "") {
  const articles = [];
  const blocks = String(html).split(/(?=<div\b[^>]*class=["']yjqk-01-cemter["'][^>]*>)/i).filter((block) => /^<div\b[^>]*class=["']yjqk-01-cemter["'][^>]*>/i.test(block));
  for (const block of blocks) {
    const link = block.match(/<a\b[^>]*href=["']([^"']*BrowseDetail\.aspx[^"']*)["'][^>]*>([\s\S]*?)<\/a>/i);
    if (!link) continue;
    const authorRaw = [...block.matchAll(/<div\b[^>]*class=["'][^"']*\byjqk-01-cemter-center\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/gi)]
      .map((match) => stripTags(match[1]))
      .find((text) => text && !/附件下载/.test(text)) || "";
    const isPartial = /(?:\.\.\.|…)/.test(authorRaw);
    const authors = isPartial ? partialAuthors(authorRaw) : normalizeAuthors(authorRaw);
    articles.push({
      title: stripTags(link[2]),
      url: normalizeUrl(link[1], baseUrl),
      authors,
      author_source: authors ? isPartial ? "list_author_partial" : "list_author" : "",
      issue_date: issueDateText,
      date_source: issueDateText ? "issue_loop" : "",
    });
  }
  return articles.filter((article) => article.title && article.url);
}

export function parseJmscReaderIssueArticles(html = "", baseUrl = "") {
  const articles = [];
  const articleRegex = /(20\d{6})\s*<a\b[^>]*href=["']([^"']*view_abstract\.aspx[^"']*)["'][^>]*>([\s\S]*?)<\/a>([\s\S]*?)(?=20\d{6}\s*<a\b|版权所有|$)/gi;
  for (const match of String(html).matchAll(articleRegex)) {
    const [, , href, titleHtml, tailHtml] = match;
    const tailText = stripTags(tailHtml);
    const issueMatch = tailText.match(/(20\d{2})\s*,?\s*\(?\s*(\d{1,2})\s*\)?\s*:/);
    const authorsText = issueMatch ? tailText.slice(0, issueMatch.index).trim() : "";
    articles.push({
      title: stripTags(titleHtml),
      url: normalizeUrl(href, baseUrl),
      authors: normalizeAuthors(authorsText),
      author_source: authorsText ? "reader_issue" : "",
      issue_date: issueDate(issueMatch?.[1], issueMatch?.[2]),
      date_source: issueMatch ? "reader_issue" : "",
    });
  }
  return articles.filter((article) => article.title && article.url);
}
