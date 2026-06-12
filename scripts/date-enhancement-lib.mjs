const monthNames = new Map([
  ["january", 1],
  ["february", 2],
  ["march", 3],
  ["april", 4],
  ["may", 5],
  ["june", 6],
  ["july", 7],
  ["august", 8],
  ["september", 9],
  ["october", 10],
  ["november", 11],
  ["december", 12],
]);

function pad2(value) {
  return String(value).padStart(2, "0");
}

function validMonth(month) {
  const value = Number(month);
  return value >= 1 && value <= 12;
}

function monthNumber(month) {
  const value = monthNames.get(String(month).toLowerCase()) || Number(month);
  return validMonth(value) ? value : "";
}

function issueDate(year, month) {
  const value = monthNumber(month);
  if (!year || !value) return "";
  return `${year}-${pad2(value)}`;
}

function publishedDate(year, month, day) {
  const value = monthNumber(month);
  if (!year || !value || Number(day) < 1 || Number(day) > 31) return "";
  return `${year}-${pad2(value)}-${pad2(day)}`;
}

function metaContent(text, name) {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const nameFirst = new RegExp(`<meta\\b(?=[^>]*\\bname=["']${escapedName}["'])(?=[^>]*\\bcontent=["']([^"']+)["'])[^>]*>`, "i");
  const propertyFirst = new RegExp(`<meta\\b(?=[^>]*\\bproperty=["']${escapedName}["'])(?=[^>]*\\bcontent=["']([^"']+)["'])[^>]*>`, "i");
  return text.match(nameFirst)?.[1] || text.match(propertyFirst)?.[1] || "";
}

function metaContents(text, name) {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const metaRegex = new RegExp(`<meta\\b(?=[^>]*\\b(?:name|property)=["']${escapedName}["'])(?=[^>]*\\bcontent=["']([^"']+)["'])[^>]*>`, "gi");
  return [...String(text).matchAll(metaRegex)].map((match) => decodeEntities(match[1]).trim()).filter(Boolean);
}

function firstMetaContent(text, names) {
  for (const name of names) {
    const value = metaContent(text, name);
    if (value) return value;
  }
  return "";
}

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

function isoDay(value = "") {
  const match = String(value).match(/\b(20\d{2})[-/](\d{1,2})[-/](\d{1,2})\b/);
  return match ? publishedDate(match[1], match[2], match[3]) : "";
}

function datePartsToIso(dateParts) {
  const parts = dateParts?.["date-parts"]?.[0] || [];
  if (!parts.length) return "";
  const [year, month, day] = parts;
  if (!year) return "";
  if (!month) return String(year);
  if (!day) return issueDate(year, month);
  return publishedDate(year, month, day);
}

function issueDateFromUrl(url = "") {
  const magtechMatch = String(url).match(/\/Y(20\d{2})\/V[^/]+\/I(\d{1,2})\//i);
  if (magtechMatch) return issueDate(magtechMatch[1], magtechMatch[2]);
  const issueMatch = String(url).match(/\/issue\/(20\d{2})_(\d{1,2})(?:\b|\/|$)/i);
  if (issueMatch) return issueDate(issueMatch[1], issueMatch[2]);
  const abstractMatch = String(url).match(/\/abstract\/(?:abstract)?(20\d{2})(\d{2})\d{2}/i);
  if (abstractMatch) return issueDate(abstractMatch[1], abstractMatch[2]);
  return "";
}

export function doiFromUrl(url = "") {
  const decoded = decodeURIComponent(String(url));
  const match = decoded.match(/\b10\.\d{4,9}\/[^\s?#"'<>()]+/i);
  return match ? match[0].replace(/[.,;:]+$/, "") : "";
}

export function extractMetadataDateHints(payload = {}) {
  const metadata = payload.message || payload;
  const published = datePartsToIso(metadata["published-online"] || metadata.published || metadata.issued);
  const print = datePartsToIso(metadata["published-print"] || metadata["journal-issue"]?.["published-print"]);
  const result = {};

  if (/^\d{4}-\d{2}-\d{2}$/.test(published)) result.published_at = published;
  if (/^\d{4}-\d{2}$/.test(print)) result.issue_date = print;
  else if (/^\d{4}-\d{2}$/.test(published) && !result.published_at) result.issue_date = published;

  if (result.published_at) result.date_source = "metadata_published";
  else if (result.issue_date) result.date_source = "metadata_issue";
  return result;
}

function normalizeAuthorName(value = "") {
  const cleaned = stripTags(value).replace(/\s+/g, " ").trim();
  if (!cleaned) return "";
  const commaParts = cleaned.split(",").map((part) => part.trim()).filter(Boolean);
  if (commaParts.length === 2 && !/[，、]/.test(cleaned)) return `${commaParts[1]} ${commaParts[0]}`.trim();
  return cleaned;
}

function expandAuthorValue(value = "") {
  const cleaned = stripTags(value).replace(/\s+/g, " ").trim();
  if (!/[\u3400-\u9fff]/.test(cleaned)) return [value];
  if (/[，、；;]/.test(cleaned) || /,\s*[\u3400-\u9fff]/.test(cleaned)) {
    return cleaned.split(/\s*(?:[，、；;]|,\s*)\s*/).filter(Boolean);
  }
  if (/^[\u3400-\u9fff·.\-\s]+$/.test(cleaned) && /\s/.test(cleaned)) {
    return cleaned.split(/\s+/).filter(Boolean);
  }
  return [cleaned];
}

function dedupeAuthors(authors = []) {
  const seen = new Set();
  const result = [];
  for (const raw of authors.flatMap(expandAuthorValue)) {
    const author = normalizeAuthorName(raw);
    const key = author.toLowerCase();
    if (!author || seen.has(key)) continue;
    seen.add(key);
    result.push(author);
  }
  return result;
}

export function extractHtmlAuthorHints(context = "") {
  const metaAuthors = dedupeAuthors([
    ...metaContents(context, "citation_author"),
    ...metaContents(context, "authors").slice(0, 1),
    ...metaContents(context, "DC.Contributor"),
    ...metaContents(context, "dc.contributor"),
    ...metaContents(context, "DC.Creator"),
    ...metaContents(context, "dc.creator"),
    ...metaContents(context, "citation_authors").slice(0, 1),
  ]);
  if (metaAuthors.length) {
    return {
      authors: metaAuthors.join(", "),
      author_source: "meta_author",
    };
  }

  const structuredAuthors = dedupeAuthors([...String(context).matchAll(/<span\b[^>]*class=["'][^"']*\bgiven-name\b[^"']*["'][^>]*>([\s\S]*?)<\/span>\s*(?:<span\b[^>]*class=["'][^"']*\badditional-name\b[^"']*["'][^>]*>([\s\S]*?)<\/span>\s*)?<span\b[^>]*class=["'][^"']*\bfamily-name\b[^"']*["'][^>]*>([\s\S]*?)<\/span>/gi)]
    .map((match) => [match[1], match[2], match[3]].filter(Boolean).map(stripTags).join(" ")));
  if (structuredAuthors.length) {
    return {
      authors: structuredAuthors.join(", "),
      author_source: "html_author",
    };
  }

  const hcardAuthors = dedupeAuthors([...String(context).matchAll(/<span\b[^>]*class=["'][^"']*\bfn\b[^"']*\bn\b[^"']*["'][^>]*>([\s\S]*?)<\/span>/gi)]
    .map((match) => stripTags(match[1])));
  if (hcardAuthors.length) {
    return {
      authors: hcardAuthors.join(", "),
      author_source: "html_author",
    };
  }

  return {};
}

export function extractMetadataAuthorHints(payload = {}) {
  const metadata = payload.message || payload;
  const authors = dedupeAuthors([
    ...(metadata.author || []).map((author) => [author.given, author.family].filter(Boolean).join(" ")),
    ...(metadata.authorships || []).map((author) => author.author?.display_name || ""),
  ]);

  return authors.length ? {
    authors: authors.join(", "),
    author_source: "metadata_author",
  } : {};
}

function abstractFromInvertedIndex(index = {}) {
  const words = [];
  for (const [word, positions] of Object.entries(index || {})) {
    for (const position of positions || []) words[position] = word;
  }
  return words.filter(Boolean).join(" ");
}

export function extractMetadataAbstractHints(payload = {}) {
  const metadata = payload.message || payload;
  const abstract = cleanAbstract(metadata.abstract || abstractFromInvertedIndex(metadata.abstract_inverted_index));
  return abstract ? { abstract } : {};
}

export function extractMetadataArticleHints(payload = {}) {
  return {
    ...extractMetadataAuthorHints(payload),
    ...extractMetadataDateHints(payload),
    ...extractMetadataAbstractHints(payload),
  };
}

function cleanAbstract(value = "") {
  let cleaned = stripTags(value)
    .replace(/^(?:摘要|Abstract)\s*[:：]?\s*/i, "")
    .replace(/\s*(?:关键词|Key\s*words?|Keywords)\s*[:：][\s\S]*$/i, "")
    .replace(/\s*服务\s+把本文推荐给朋友[\s\S]*$/i, "")
    .trim();
  const nestedAbstract = cleaned.match(/^(?:参考文献|补充材料|相关文章|推荐阅读|下载|PDF|\s)+摘要\s+([\s\S]+)$/i);
  if (nestedAbstract) cleaned = nestedAbstract[1].trim();
  if (["参考文献", "补充材料", "相关文章", "推荐阅读", "下载", "PDF", "输出"].some((prefix) => cleaned.startsWith(prefix))) {
    const nestedIndex = cleaned.lastIndexOf("摘要 ");
    if (nestedIndex > 0) cleaned = cleaned.slice(nestedIndex + "摘要 ".length).trim();
  }
  return cleaned;
}

function bodyAbstractCandidates(context = "") {
  const text = stripTags(context);
  const candidates = [];
  const abstractRegex = /(?:^|\s)(?:摘要|Abstract)\s*[:：]?\s*([\s\S]*?)(?=\s+(?:关键词|Key\s*words?|Keywords|Summary|服务|参考文献|基金项目|中图分类号|作者简介|收稿日期|$))/gi;
  for (const match of text.matchAll(abstractRegex)) {
    const candidate = cleanAbstract(match[1]);
    if (candidate.length < 20) continue;
    if (/^(参考文献|补充材料|相关文章|推荐阅读|下载|PDF)\b/i.test(candidate)) continue;
    candidates.push(candidate);
  }
  return candidates.sort((a, b) => {
    const zhOrder = /[\u3400-\u9fff]/.test(b) - /[\u3400-\u9fff]/.test(a);
    if (zhOrder) return zhOrder;
    return b.length - a.length;
  });
}

function parseKeywords(value = "", splitWhitespace = false) {
  const normalized = stripTags(value).replace(/^(?:关键词|Key\s*words?|Keywords)\s*[:：]\s*/i, "");
  const separator = splitWhitespace ? /[\s,，、;；]+/ : /[,，、;；]+/;
  const seen = new Set();
  const keywords = [];
  for (const keyword of normalized
    .split(separator)
    .map((keyword) => keyword.trim())
    .filter(Boolean)) {
    const key = keyword.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    keywords.push(keyword);
  }
  return keywords;
}

function looksLikeNcpssdArticleShell(context = "") {
  return /\/articleinfoHandler\/getjournalarticletable/i.test(context)
    && /\bid=["']ftl_urlId["']/i.test(context);
}

export function extractHtmlAbstractHints(context = "") {
  const metaAbstract = firstMetaContent(context, [
    "citation_abstract",
    "DC.Description",
    "dc.description",
  ]);
  const result = {};
  if (!metaAbstract && looksLikeNcpssdArticleShell(context)) return result;

  const abstract = cleanAbstract(metaAbstract)
    || bodyAbstractCandidates(context)[0]
    || cleanAbstract(stripTags(context).match(/(?:摘要|Abstract)\s*[:：]\s*([\s\S]{20,}?)(?:\s*(?:关键词|Key\s*words?|Keywords)\s*[:：]|$)/i)?.[1] || "");
  if (abstract) result.abstract = abstract;

  const metaKeywords = [
    ...metaContents(context, "citation_keywords"),
    ...metaContents(context, "keywords"),
    ...metaContents(context, "DC.Subject"),
    ...metaContents(context, "dc.subject"),
  ].join(";");
  const bodyKeywords = stripTags(context).match(/(?:关键词|Key\s*words?|Keywords)\s*[:：]\s*([\s\S]*?)(?:\s*(?:摘要|Abstract|Key\s*words?|Keywords|Downloads?|Preview|Journals?|基金项目|中图分类号|JEL|作者简介|参考文献|收稿日期|$))/i)?.[1] || "";
  const splitBodyKeywordsOnWhitespace = !/[;,，、；]/.test(bodyKeywords) && /[\u3400-\u9fff]/.test(bodyKeywords);
  const keywords = parseKeywords(metaKeywords || bodyKeywords, !metaKeywords && splitBodyKeywordsOnWhitespace);
  if (keywords.length) result.keywords = keywords;
  return result;
}

export function extractHtmlArticleHints({ url = "", context = "" } = {}) {
  return {
    ...extractHtmlAuthorHints(context),
    ...extractHtmlAbstractHints(context),
    ...extractDateHints({ url, context }),
  };
}

export function extractDateHints({ url = "", context = "" } = {}) {
  const haystack = `${url} ${context}`.replace(/\s+/g, " ");
  const metaIssue = firstMetaContent(context, ["citation_issue"]);
  const issueFromUrl = issueDateFromUrl(url);
  const explicitFirstPublished = isoDay(
    haystack.match(/"shouCiFaBuRiQi"\s*:\s*"([^"]+)"/)?.[1]
    || haystack.match(/首次(?:发表|发布)(?:日期|时间|日)?[^0-9]*(20\d{2}[-/]\d{1,2}[-/]\d{1,2})/)?.[1]
    || "",
  );
  if (explicitFirstPublished) {
    const issueMonth = metaIssue ? issueDate(explicitFirstPublished.slice(0, 4), metaIssue.replace(/^0+/, "")) : issueFromUrl;
    return {
      published_at: explicitFirstPublished,
      ...(issueMonth ? { issue_date: issueMonth } : {}),
      date_source: "context_published",
    };
  }

  const metaPublished = isoDay(firstMetaContent(context, [
    "citation_online_date",
    "citation_publication_date",
    "citation_date",
    "DC.Date",
    "article:published_time",
  ]));
  if (metaPublished || metaIssue) {
    const issueMonth = metaIssue ? issueDate(metaPublished.slice(0, 4), metaIssue.replace(/^0+/, "")) : "";
    return {
      ...(metaPublished ? { published_at: metaPublished } : {}),
      ...(issueMonth ? { issue_date: issueMonth } : {}),
      date_source: metaPublished ? "meta_published" : "meta_issue",
    };
  }

  const onlineMatch = haystack.match(/(?:Version of Record online|Published online|First published)\s*:?\s*(\d{1,2})\/(\d{1,2})\/(20\d{2})/i);
  if (onlineMatch) {
    return {
      published_at: publishedDate(onlineMatch[3], onlineMatch[1], onlineMatch[2]),
      date_source: "context_published",
    };
  }

  const namedOnlineMatch = haystack.match(/(?:Version of Record online|Published online|First published(?: online)?)\s*:?\s*(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),?\s+(20\d{2})/i);
  if (namedOnlineMatch) {
    return {
      published_at: publishedDate(namedOnlineMatch[3], namedOnlineMatch[1], namedOnlineMatch[2]),
      date_source: "context_published",
    };
  }

  const urlMagtechMatch = issueFromUrl && url.match(/\/Y(20\d{2})\/V[^/]+\/I(\d{1,2})\//i);
  if (urlMagtechMatch) {
    return {
      issue_date: issueFromUrl,
      date_source: "url_issue",
    };
  }

  const urlIssueMatch = issueFromUrl && url.match(/\/issue\/(20\d{2})_(\d{1,2})(?:\b|\/|$)/i);
  if (urlIssueMatch) {
    return {
      issue_date: issueFromUrl,
      date_source: "url_issue",
    };
  }

  const urlAbstractMatch = issueFromUrl && url.match(/\/abstract\/(?:abstract)?(20\d{2})(\d{2})\d{2}/i);
  if (urlAbstractMatch) {
    return {
      issue_date: issueFromUrl,
      date_source: "url_issue",
    };
  }

  const cnIssueMatch = haystack.match(/(20\d{2})\s*年\s*[,，]?\s*第?\s*(\d{1,2})\s*期/i);
  if (cnIssueMatch) {
    return {
      issue_date: issueDate(cnIssueMatch[1], cnIssueMatch[2]),
      date_source: "context_issue",
    };
  }

  const parenIssueMatch = haystack.match(/(20\d{2})\s*[,，]?\s*\d*\s*\((\d{1,2})\)/);
  if (parenIssueMatch) {
    return {
      issue_date: issueDate(parenIssueMatch[1], parenIssueMatch[2]),
      date_source: "context_issue",
    };
  }

  const englishIssueMatch = haystack.match(/\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(20\d{2})\s+Table of Contents\b/i);
  if (englishIssueMatch) {
    return {
      issue_date: issueDate(englishIssueMatch[2], monthNames.get(englishIssueMatch[1].toLowerCase())),
      date_source: "context_issue",
    };
  }

  if (/\bForthcoming(?:\s+Article| Articles)?\b/i.test(haystack)) {
    return {
      date_source: "forthcoming_unassigned",
    };
  }

  return {};
}
