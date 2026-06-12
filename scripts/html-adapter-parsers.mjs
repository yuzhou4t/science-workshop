import { macrodatasArticleSectionUrl } from "./macrodatas-url.mjs";

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

function compactText(value = "") {
  return stripTags(value)
    .normalize("NFKC")
    .replace(/[：﹕]/g, ":")
    .replace(/[‐‑‒–—]/g, "-")
    .replace(/\s+/g, "")
    .trim();
}

function parseMacrodatasKeywords(value = "") {
  return stripTags(value)
    .split(/[\s,，、;；]+/)
    .map((keyword) => keyword.trim())
    .filter(Boolean);
}

function parseMacrodatasDetailSections(html = "") {
  const text = stripTags(html);
  const details = [];
  const sectionRegex = /#\s*(\d{2})\s*#([\s\S]*?)(?=#\s*\d{2}\s*#|$)/g;
  for (const match of text.matchAll(sectionRegex)) {
    const section = match[2];
    const title = section.match(/题目[:：]\s*([\s\S]*?)\s*作者[:：]/)?.[1]?.trim() || "";
    const abstract = section.match(/摘要[:：]\s*([\s\S]*?)\s*关键词[:：]/)?.[1]?.trim() || "";
    const keywordText = section.match(/关键词[:：]\s*([\s\S]*?)(?:\s*录用周期[:：]|\s*马克相关数据[:：]|\s*收稿时间[:：]|$)/)?.[1] || "";
    details.push({
      number: match[1],
      title,
      title_key: compactText(title),
      abstract,
      keywords: parseMacrodatasKeywords(keywordText),
    });
  }
  return details;
}

function enrichMacrodatasArticle(article, detail) {
  if (!detail) return article;
  return {
    ...article,
    abstract: detail.abstract || article.abstract || "",
    keywords: detail.keywords?.length ? detail.keywords : article.keywords || [],
  };
}

function dedupeByTitle(items) {
  const seen = new Set();
  const deduped = [];
  for (const item of items) {
    const key = compactText(item.title);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    deduped.push(item);
  }
  return deduped;
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
  const rows = String(html).match(/<tr\b[\s\S]*?<\/tr>/gi) || [];
  for (const row of rows) {
    const cells = [...row.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map((match) => match[1]);
    const fileNo = stripTags(cells[0] || "").match(/^20\d{6}$/)?.[0] || "";
    const link = row.match(/<a\b[^>]*href=["']([^"']*view_abstract\.aspx[^"']*)["'][^>]*>([\s\S]*?)<\/a>/i);
    if (!fileNo || !link) continue;
    const issueText = stripTags(cells[3] || "");
    const issueMatch = issueText.match(/(20\d{2})\s*,?\s*\(?\s*(\d{1,2})\s*\)?\s*:/);
    const authors = normalizeAuthors(cells[2] || "");
    articles.push({
      title: stripTags(link[2]),
      url: normalizeUrl(link[1], baseUrl),
      authors,
      author_source: authors ? "reader_issue" : "",
      issue_date: issueDate(issueMatch?.[1], issueMatch?.[2]),
      date_source: issueMatch ? "reader_issue" : "",
    });
  }
  if (articles.length) return articles.filter((article) => article.title && article.url);

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

export function parseMacrodatasIssuePageArticles(html = "", pageUrl = "") {
  const releaseDate = String(html).match(/document\.write\("([^"]{10})/)?.[1] || "";
  const details = parseMacrodatasDetailSections(html);
  const detailByTitle = new Map(details.filter((detail) => detail.title_key).map((detail) => [detail.title_key, detail]));
  const detailByNumber = new Map(details.map((detail) => [detail.number, detail]));
  const articles = [];
  const entryRegex = /<p[^>]*>\s*(\d{2})\s+([\s\S]*?)<\/p>\s*<p[^>]*style=["'][^"']*color:[^"']*["'][^>]*>([\s\S]*?)<\/p>/gi;
  for (const match of String(html).matchAll(entryRegex)) {
    const number = match[1];
    const title = stripTags(match[2]);
    if (!title) continue;
    const detail = detailByTitle.get(compactText(title)) || detailByNumber.get(number);
    articles.push(enrichMacrodatasArticle({
      title,
      url: macrodatasArticleSectionUrl(pageUrl, title),
      date: releaseDate,
      authors: stripTags(match[3]),
    }, detail));
  }

  if (articles.length) return dedupeByTitle(articles);

  const text = stripTags(html);
  let directory = text.slice(Math.max(0, text.indexOf("目录")));
  const firstItemIndex = directory.search(/\b01\s+/);
  if (firstItemIndex >= 0) directory = directory.slice(firstItemIndex);
  const firstDetailIndex = directory.search(/#\s*01\s*#/);
  if (firstDetailIndex > 0) directory = directory.slice(0, firstDetailIndex);
  const fallbackRegex = /(?:^|\s)(\d{2})\s+(.+?)(?=\s+\d{2}\s+|$)/g;
  for (const match of directory.matchAll(fallbackRegex)) {
    const number = match[1];
    const title = match[2].trim();
    if (!title) continue;
    const detail = detailByTitle.get(compactText(title)) || detailByNumber.get(number);
    articles.push(enrichMacrodatasArticle({
      title,
      url: macrodatasArticleSectionUrl(pageUrl, title),
      date: releaseDate,
      authors: "",
    }, detail));
  }
  return dedupeByTitle(articles);
}
