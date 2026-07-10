import { readFile } from "node:fs/promises";

function asText(value) {
  return String(value ?? "").trim();
}

function isHttpUrl(value) {
  try {
    const url = new URL(asText(value));
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function sourceUrl(item) {
  return asText(item.feed_url || item.source_url || item.homepage_url || item.final_url || item.url);
}

function candidateType(item) {
  return asText(
    item.candidate_type
      || item.probe_report?.candidate_type
      || item.probe_report?.candidateType
      || item.source_type,
  ).toLowerCase();
}

function toDirectFeed(item) {
  const feedUrl = asText(item.feed_url || item.probe_report?.feed_url || item.probe_report?.final_url);
  if (!isHttpUrl(feedUrl)) return null;
  return {
    journal_id: asText(item.journal_id || `community-${asText(item.request_id || item.id)}`),
    journal_name: asText(item.journal_name || "未命名来源"),
    feed_url: feedUrl,
    parser_profile: asText(item.parser_profile || "community-rss"),
    runtime_source: true,
    request_id: asText(item.request_id || item.id),
  };
}

function toAdapterSource(item) {
  const source = sourceUrl(item);
  if (!isHttpUrl(source)) return null;
  const type = candidateType(item);
  const metadata = /metadata|crossref|openalex|doi/.test(type);
  return {
    journal_id: asText(item.journal_id || `community-${asText(item.request_id || item.id)}`),
    journal_name: asText(item.journal_name || "未命名来源"),
    platform_id: asText(item.platform_id || (metadata ? "community-open-metadata" : "community-page-adapter")),
    source_url: source,
    adapter_rule: {
      kind: asText(item.adapter_kind || item.probe_report?.adapter_kind || (metadata ? "open-metadata-runtime" : "community-page-adapter")),
      issns: item.issn ? [item.issn] : [],
      fallback_services: metadata ? ["crossref", "openalex"] : [],
    },
    runtime_source: true,
    request_id: asText(item.request_id || item.id),
  };
}

/**
 * Convert an approved runtime record to the shape consumed by the crawler.
 * Invalid or non-approved records are ignored deliberately.
 */
export function normalizeApprovedRuntimeSource(item) {
  if (!item || (item.status && item.status !== "approved") || (item.decision && item.decision !== "approved")) {
    return null;
  }
  const type = candidateType(item);
  if (/rss|atom|feed|rsshub/.test(type) || item.feed_url || item.probe_report?.feed_url) {
    return toDirectFeed(item);
  }
  if (/metadata|crossref|openalex|doi|page|html|adapter/.test(type)) {
    return toAdapterSource(item);
  }
  return null;
}

export function mergeRuntimeSources(registry, runtimePayload = {}) {
  const records = Array.isArray(runtimePayload)
    ? runtimePayload
    : Array.isArray(runtimePayload.sources)
      ? runtimePayload.sources
      : Array.isArray(runtimePayload.approved_sources)
        ? runtimePayload.approved_sources
        : [];
  const direct = [...(registry.direct_article_feeds || [])];
  const adapters = [...(registry.adapter_queue || [])];
  const existingIds = new Set([...direct, ...adapters].map((item) => asText(item.journal_id)));
  const existingUrls = new Set([...direct.map((item) => item.feed_url), ...adapters.map((item) => item.source_url)].filter(Boolean));
  for (const record of records) {
    const source = normalizeApprovedRuntimeSource(record);
    if (!source || existingIds.has(source.journal_id) || existingUrls.has(source.feed_url || source.source_url)) continue;
    if (source.feed_url) direct.push(source);
    else adapters.push(source);
    existingIds.add(source.journal_id);
    existingUrls.add(source.feed_url || source.source_url);
  }
  return {
    ...registry,
    direct_article_feeds: direct,
    adapter_queue: adapters,
    runtime_sources_loaded: direct.filter((item) => item.runtime_source).length + adapters.filter((item) => item.runtime_source).length,
  };
}

export async function loadRuntimeSources(path, options = {}) {
  try {
    const payload = JSON.parse(await readFile(path, "utf8"));
    return mergeRuntimeSources(options.registry || {}, payload);
  } catch (error) {
    if (error.code === "ENOENT") return options.registry || {};
    if (options.ignoreInvalid) return options.registry || {};
    throw error;
  }
}
