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

function issueDate(year, month) {
  if (!year || !validMonth(month)) return "";
  return `${year}-${pad2(month)}`;
}

function publishedDate(year, month, day) {
  if (!year || !validMonth(month) || Number(day) < 1 || Number(day) > 31) return "";
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

function metaContent(text, name) {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const nameFirst = new RegExp(`<meta\\b(?=[^>]*\\bname=["']${escapedName}["'])(?=[^>]*\\bcontent=["']([^"']+)["'])[^>]*>`, "i");
  const propertyFirst = new RegExp(`<meta\\b(?=[^>]*\\bproperty=["']${escapedName}["'])(?=[^>]*\\bcontent=["']([^"']+)["'])[^>]*>`, "i");
  return text.match(nameFirst)?.[1] || text.match(propertyFirst)?.[1] || "";
}

function firstMetaContent(text, names) {
  for (const name of names) {
    const value = metaContent(text, name);
    if (value) return value;
  }
  return "";
}

function isoDay(value = "") {
  const match = String(value).match(/\b(20\d{2})-(\d{1,2})-(\d{1,2})\b/);
  return match ? publishedDate(match[1], match[2], match[3]) : "";
}

export function extractDateHints({ url = "", context = "" } = {}) {
  const haystack = `${url} ${context}`.replace(/\s+/g, " ");

  const metaPublished = isoDay(firstMetaContent(context, [
    "citation_online_date",
    "citation_publication_date",
    "citation_date",
    "DC.Date",
    "article:published_time",
  ]));
  const metaIssue = firstMetaContent(context, ["citation_issue"]);
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

  const urlMagtechMatch = url.match(/\/Y(20\d{2})\/V[^/]+\/I(\d{1,2})\//i);
  if (urlMagtechMatch) {
    return {
      issue_date: issueDate(urlMagtechMatch[1], urlMagtechMatch[2]),
      date_source: "url_issue",
    };
  }

  const urlIssueMatch = url.match(/\/issue\/(20\d{2})_(\d{1,2})(?:\b|\/|$)/i);
  if (urlIssueMatch) {
    return {
      issue_date: issueDate(urlIssueMatch[1], urlIssueMatch[2]),
      date_source: "url_issue",
    };
  }

  const urlAbstractMatch = url.match(/\/abstract\/(?:abstract)?(20\d{2})(\d{2})\d{2}/i);
  if (urlAbstractMatch) {
    return {
      issue_date: issueDate(urlAbstractMatch[1], urlAbstractMatch[2]),
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
