import { createHash } from "node:crypto";

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

  const dayMatch = raw.match(/\b(20\d{2})-(\d{1,2})-(\d{1,2})\b/);
  if (dayMatch) {
    const [, year, month, day] = dayMatch;
    return {
      raw,
      normalized: `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`,
      precision: "day",
      status: "known",
    };
  }

  const monthMatch = raw.match(/\b(20\d{2})-(\d{1,2})\b/);
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

function stableArticleId(source, article) {
  const key = [
    source.journal_id,
    article.url || "",
    article.title || "",
    article.date || "",
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

function sourceArticles(source) {
  return (source.articles?.length ? source.articles : source.samples || []).filter((article) => article?.title);
}

function toWorkflowArticle(source, article, options, previousIds) {
  const dateInfo = normalizeWorkflowDate(article.date);
  const id = stableArticleId(source, article);
  const inWindow = isInsideWindow(dateInfo.normalized, dateInfo.precision, options.since, options.until);
  const isNew = !options.baseline && !previousIds.has(id);
  const inclusionReason = inWindow
    ? dateInfo.precision === "month" ? "month_overlaps_window" : "date_within_window"
    : dateInfo.status === "unknown" ? "undated_latest_candidate" : "outside_window";
  const pushBasis = !isNew
    ? ""
    : inWindow
      ? "published_date"
      : dateInfo.status === "unknown"
        ? "first_seen"
        : "";

  return {
    id,
    journal_id: source.journal_id,
    journal_name: source.journal_name,
    source_type: source.type,
    source_url: source.source_url,
    probe_url: source.probe_url,
    extraction_rule: source.extraction_rule,
    title: article.title,
    url: article.url || "",
    authors: article.authors || "",
    published_at: dateInfo.normalized,
    date_raw: dateInfo.raw,
    date_precision: dateInfo.precision,
    date_status: dateInfo.status,
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
    const dateOrder = String(b.published_at || "").localeCompare(String(a.published_at || ""));
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
  const sourceState = {
    version: 1,
    checked_at: checkedAt,
    since,
    until,
    article_ids: [],
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
    }, seenBefore));
    const sourceRecent = sourceItems.filter((article) => ["date_within_window", "month_overlaps_window"].includes(article.inclusion_reason));
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
      push_count: sourcePushQueue.length,
      last_success_at: checkedAt,
    };
  }

  sourceState.article_ids = Object.values(sourceState.sources).flatMap((source) => source.article_ids);
  const recentArticles = sortArticles(dedupeById(recent));
  const undatedCandidates = sortArticles(dedupeById(undated));
  const pushArticles = sortArticles(dedupeById(pushQueue));

  return {
    summary: {
      checked_at: checkedAt,
      since,
      until,
      sources_total: results.length,
      sources_ready: readySources.length,
      recent_articles: recentArticles.length,
      new_recent_articles: recentArticles.filter((article) => article.is_new).length,
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
