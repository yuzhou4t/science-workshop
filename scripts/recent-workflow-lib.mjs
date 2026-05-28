import { createHash } from "node:crypto";

const canonicalJournalIds = new Map([
  ["j1", "j14"],
]);

export function dateOnly(value = new Date()) {
  return value.toISOString().slice(0, 10);
}

export function addDays(dateText, days) {
  const date = new Date(`${dateText}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return dateOnly(date);
}

export function normalizeWorkflowDate(rawValue = "") {
  const raw = String(rawValue || "").trim();
  if (!raw) return { raw, normalized: "", precision: "unknown", status: "unknown" };

  const dayMatch = raw.match(/\b(20\d{2})-(\d{1,2})-(\d{1,2})(?!\d)/);
  if (dayMatch) {
    const [, year, month, day] = dayMatch;
    return {
      raw,
      normalized: `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`,
      precision: "day",
      status: "known",
    };
  }

  const monthMatch = raw.match(/\b(20\d{2})-(\d{1,2})(?!-\d)(?:\b|$)/);
  if (monthMatch) {
    const [, year, month] = monthMatch;
    return {
      raw,
      normalized: `${year}-${month.padStart(2, "0")}`,
      precision: "month",
      status: "known",
    };
  }

  const parsed = new Date(raw);
  if (!Number.isNaN(parsed.valueOf())) {
    return { raw, normalized: dateOnly(parsed), precision: "day", status: "known" };
  }

  return { raw, normalized: "", precision: "unknown", status: "unknown" };
}

function monthRange(monthText) {
  const [year, month] = monthText.split("-").map(Number);
  const start = `${year}-${String(month).padStart(2, "0")}-01`;
  const endDate = new Date(Date.UTC(year, month, 0));
  return { start, end: dateOnly(endDate) };
}

function isInsideWindow(normalizedDate, precision, since, until) {
  if (precision === "day") return normalizedDate >= since && normalizedDate <= until;
  if (precision === "month") {
    const range = monthRange(normalizedDate);
    return range.start <= until && range.end >= since;
  }
  return false;
}

function isAfterWindow(normalizedDate, precision, until) {
  if (precision === "day") return normalizedDate > until;
  if (precision === "month") return monthRange(normalizedDate).start > until;
  return false;
}

function bestDateInfo(...dateInfos) {
  return dateInfos.find((dateInfo) => dateInfo.status === "known") || {
    raw: "",
    normalized: "",
    precision: "unknown",
    status: "unknown",
  };
}

function canonicalJournalId(id) {
  return canonicalJournalIds.get(id) || id;
}

function normalizedDoi(value = "") {
  const decoded = decodeURIComponent(String(value || ""));
  const match = decoded.match(/\b10\.\d{4,9}\/[^\s?#"'<>]+/i);
  return match ? match[0].replace(/[.,;:)\]]+$/, "").toLowerCase() : "";
}

function normalizedUrlForIdentity(value = "") {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try {
    const url = new URL(raw);
    url.hostname = url.hostname.toLowerCase();
    if (!/macrodatas\.cn$/i.test(url.hostname) || !url.hash.startsWith("#:~:text=")) {
      url.hash = "";
    }
    for (const key of [...url.searchParams.keys()]) {
      if (/^utm_/i.test(key) || ["sign", "expireTime", "expires", "_t", "timestamp", "token"].includes(key)) {
        url.searchParams.delete(key);
      }
    }
    if (/cqvip\.com$/i.test(url.hostname) && /\/doc\/journal\/\d+/i.test(url.pathname)) {
      url.searchParams.delete("resourceId");
      url.searchParams.delete("type");
    }
    url.searchParams.sort();
    return url.toString().replace(/\/$/, "").toLowerCase();
  } catch {
    return raw.split("#")[0].replace(/\/$/, "").toLowerCase();
  }
}

function articleIdentity(source, article) {
  const doi = normalizedDoi(article.doi || article.url);
  if (doi) return `doi:${doi}`;
  const url = normalizedUrlForIdentity(article.url);
  if (url) return `url:${url}`;
  return `title:${String(article.title || "").replace(/\s+/g, " ").trim().toLowerCase()}::${article.date || article.issue_date || article.published_at || ""}`;
}

function stableArticleId(source, article) {
  const key = [
    canonicalJournalId(source.journal_id),
    articleIdentity(source, article),
  ].join("::");
  return createHash("sha1").update(key).digest("hex").slice(0, 16);
}

function previousArticleIds(previousState = {}) {
  const ids = new Set(previousState.article_ids || []);
  for (const source of Object.values(previousState.sources || {})) {
    for (const id of source.article_ids || []) ids.add(id);
  }
  return ids;
}

function previousFirstSeenDates(previousState = {}) {
  const dates = new Map(Object.entries(previousState.first_seen_by_id || {}));
  const fallback = normalizeWorkflowDate(previousState.checked_at).normalized;
  if (fallback) {
    for (const id of previousArticleIds(previousState)) {
      if (!dates.has(id)) dates.set(id, fallback);
    }
  }
  return dates;
}

function sourceArticles(source) {
  return (source.articles?.length ? source.articles : source.samples || []).filter((article) => article?.title);
}

function toWorkflowArticle(source, article, options, previousIds, previousFirstSeenById) {
  const id = stableArticleId(source, article);
  const fallbackDateInfo = normalizeWorkflowDate(article.date);
  const publishedDateInfo = normalizeWorkflowDate(article.published_at || (fallbackDateInfo.precision === "day" ? article.date : ""));
  const issueDateInfo = normalizeWorkflowDate(article.issue_date || (fallbackDateInfo.precision === "month" ? article.date : ""));
  const firstSeenInfo = normalizeWorkflowDate(article.first_seen_at || previousFirstSeenById.get(id) || options.checkedAt);
  const displayDateInfo = bestDateInfo(publishedDateInfo, issueDateInfo, firstSeenInfo);
  const publishedInWindow = isInsideWindow(publishedDateInfo.normalized, publishedDateInfo.precision, options.since, options.until);
  const issueInWindow = !publishedInWindow && isInsideWindow(issueDateInfo.normalized, issueDateInfo.precision, options.since, options.until);
  const isNew = !options.baseline && (options.forcePushAll || !previousIds.has(id));
  const hasNoUsableDate = publishedDateInfo.status === "unknown" && issueDateInfo.status === "unknown";
  const futureIssueFirstSeen = isNew && !publishedInWindow && !issueInWindow && isAfterWindow(issueDateInfo.normalized, issueDateInfo.precision, options.until);
  const newDiscoveryOutsideWindow = Boolean(options.pushNewDiscoveries) && isNew && !publishedInWindow && !issueInWindow && !futureIssueFirstSeen && !hasNoUsableDate;
  const inclusionReason = publishedInWindow
    ? "date_within_window"
    : issueInWindow
      ? "issue_overlaps_window"
      : futureIssueFirstSeen
        ? "future_issue_first_seen"
        : newDiscoveryOutsideWindow
          ? "new_discovery_outside_window"
        : hasNoUsableDate
          ? "undated_latest_candidate"
          : "outside_window";
  const pushBasis = !isNew
    ? ""
    : publishedInWindow
      ? "published_date"
      : issueInWindow
      ? "issue_date"
      : futureIssueFirstSeen
        ? "issue_date"
        : newDiscoveryOutsideWindow
          ? "first_seen"
        : hasNoUsableDate
          ? "first_seen"
          : "";
  const displayDateBasis = publishedDateInfo.status === "known"
    ? "published_at"
    : issueDateInfo.status === "known"
      ? "issue_date"
      : "first_seen_at";

  return {
    id,
    journal_id: canonicalJournalId(source.journal_id),
    source_journal_id: source.journal_id,
    journal_name: source.journal_name,
    source_type: source.type,
    source_url: source.source_url,
    probe_url: source.probe_url,
    extraction_rule: source.extraction_rule,
    title: article.title,
    url: article.url || "",
    authors: article.authors || "",
    published_at: publishedDateInfo.status === "known" && publishedDateInfo.precision === "day" ? publishedDateInfo.normalized : "",
    issue_date: issueDateInfo.status === "known" ? issueDateInfo.normalized : "",
    first_seen_at: firstSeenInfo.normalized,
    display_date: displayDateInfo.normalized,
    display_date_basis: displayDateBasis,
    date_raw: publishedDateInfo.raw || issueDateInfo.raw,
    date_precision: publishedDateInfo.status === "known" ? publishedDateInfo.precision : issueDateInfo.precision,
    date_status: publishedDateInfo.status === "known" || issueDateInfo.status === "known" ? "known" : "unknown",
    date_source: article.date_source || "",
    inclusion_reason: inclusionReason,
    push_basis: pushBasis,
    observed_at: options.checkedAt,
    is_new: isNew,
  };
}

function dedupeById(items) {
  const seen = new Set();
  const deduped = [];
  for (const item of items) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    deduped.push(item);
  }
  return deduped;
}

function sortArticles(items) {
  return [...items].sort((a, b) => {
    const dateOrder = String(b.display_date || b.published_at || "").localeCompare(String(a.display_date || a.published_at || ""));
    if (dateOrder) return dateOrder;
    return a.title.localeCompare(b.title, "zh-Hans-CN");
  });
}

export function buildRecentWorkflow(results, options) {
  const since = options.since;
  const until = options.until;
  const checkedAt = options.checkedAt || new Date().toISOString();
  const readySources = results.filter((source) => source.usable_as_data_source);
  const seenBefore = previousArticleIds(options.previousState);
  const firstSeenBefore = previousFirstSeenDates(options.previousState);
  const sourceState = {
    version: 1,
    checked_at: checkedAt,
    since,
    until,
    daily_initialized: Boolean(options.daily || options.previousState?.daily_initialized),
    article_ids: [],
    first_seen_by_id: Object.fromEntries(firstSeenBefore),
    sources: {},
  };
  const recent = [];
  const undated = [];
  const pushQueue = [];

  for (const source of readySources) {
    const sourceItems = sourceArticles(source).map((article) => toWorkflowArticle(source, article, {
      since,
      until,
      checkedAt,
      baseline: Boolean(options.baseline),
      forcePushAll: Boolean(options.forcePushAll),
      pushNewDiscoveries: Boolean(options.pushNewDiscoveries),
    }, seenBefore, firstSeenBefore));
    const sourceRecent = sourceItems.filter((article) => ["date_within_window", "issue_overlaps_window", "future_issue_first_seen"].includes(article.inclusion_reason));
    const sourceUndated = sourceItems.filter((article) => article.inclusion_reason === "undated_latest_candidate");
    const sourcePushQueue = sourceItems.filter((article) => Boolean(article.push_basis));
    recent.push(...sourceRecent);
    undated.push(...sourceUndated);
    pushQueue.push(...sourcePushQueue);
    sourceState.sources[source.journal_id] = {
      journal_name: source.journal_name,
      source_url: source.source_url,
      probe_url: source.probe_url,
      extraction_rule: source.extraction_rule,
      article_ids: sourceItems.map((article) => article.id),
      recent_article_ids: sourceRecent.map((article) => article.id),
      undated_article_ids: sourceUndated.map((article) => article.id),
      push_article_ids: sourcePushQueue.map((article) => article.id),
      article_count: sourceItems.length,
      recent_count: sourceRecent.length,
      undated_count: sourceUndated.length,
      issue_dated_count: sourceItems.filter((article) => article.issue_date && !article.published_at).length,
      push_count: sourcePushQueue.length,
      last_success_at: checkedAt,
    };
    for (const article of sourceItems) {
      sourceState.first_seen_by_id[article.id] = article.first_seen_at;
    }
  }

  for (const source of results.filter((item) => !item.usable_as_data_source)) {
    const previousSource = options.previousState?.sources?.[source.journal_id];
    if (!previousSource) continue;
    sourceState.sources[source.journal_id] = {
      ...previousSource,
      last_failed_at: checkedAt,
    };
    for (const id of previousSource.article_ids || []) {
      const firstSeen = firstSeenBefore.get(id);
      if (firstSeen) sourceState.first_seen_by_id[id] = firstSeen;
    }
  }

  sourceState.article_ids = [
    ...new Set([
      ...seenBefore,
      ...Object.values(sourceState.sources).flatMap((source) => source.article_ids),
    ]),
  ];
  const recentArticles = sortArticles(dedupeById(recent));
  const undatedCandidates = sortArticles(dedupeById(undated));
  const pushArticles = sortArticles(dedupeById(pushQueue));
  const issueDatedArticles = recentArticles.filter((article) => article.issue_date && !article.published_at);

  return {
    summary: {
      checked_at: checkedAt,
      since,
      until,
      sources_total: results.length,
      sources_ready: readySources.length,
      recent_articles: recentArticles.length,
      new_recent_articles: recentArticles.filter((article) => article.is_new).length,
      issue_dated_articles: issueDatedArticles.length,
      new_undated_articles: undatedCandidates.filter((article) => article.is_new).length,
      undated_candidates: undatedCandidates.length,
      push_queue_articles: pushArticles.length,
    },
    recent_articles: recentArticles,
    undated_candidates: undatedCandidates,
    push_queue: pushArticles,
    source_state: sourceState,
  };
}
