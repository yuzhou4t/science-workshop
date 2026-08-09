import { compactArticleTitle } from "./official-link-resolvers.mjs";

export const sharedFeedContractVersion = "metadata-feed/1.0.0";
const allowedJournalIds = new Set(Array.from({ length: 22 }, (_, index) => `j${index + 1}`));

function canonicalJournalId(value) {
  return value === "j1" ? "j14" : value;
}

function normalizedDoi(value = "") {
  const match = decodeURIComponent(String(value || "")).match(/\b10\.\d{4,9}\/[^\s?#"'<>]+/iu);
  return match ? match[0].replace(/[.,;:)\]]+$/u, "").toLowerCase() : "";
}

function stableUrl(value = "") {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try {
    const url = new URL(raw);
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
      if (/^utm_/iu.test(key) || ["sign", "expireTime", "expires", "token", "timestamp"].includes(key)) {
        url.searchParams.delete(key);
      }
    }
    url.searchParams.sort();
    return url.toString().replace(/\/$/u, "").toLowerCase();
  } catch {
    return raw.split("#")[0].replace(/\/$/u, "").toLowerCase();
  }
}

function articleDoi(article) {
  const identifier = article.identifiers?.find((item) => item.type === "doi")?.value;
  return normalizedDoi(identifier || article.doi || article.official_url || article.url);
}

function aliases(article) {
  const journalId = canonicalJournalId(article.journal_id || article.source_journal_id || "");
  const title = compactArticleTitle(article.title || "");
  return [
    article.id || article.article_id ? `id:${article.id || article.article_id}` : "",
    articleDoi(article) ? `doi:${articleDoi(article)}` : "",
    ...[article.pdf_url, article.official_url, article.url, article.discovery_url]
      .map(stableUrl)
      .filter(Boolean)
      .map((url) => `url:${url}`),
    title ? `title:${journalId}:${title}` : "",
  ].filter(Boolean);
}

function linkRank(article) {
  const url = article.pdf_url || article.official_url || article.url || "";
  if (article.pdf_url || /\.pdf(?:$|[?#])/iu.test(url)) return 3;
  if (url && !/^https?:\/\/(?:dx\.)?doi\.org\//iu.test(url)) return 2;
  if (url) return 1;
  return 0;
}

export function mapSharedFeedRecord(record) {
  const sourceJournalId = String(record.journal_id || "");
  if (!allowedJournalIds.has(sourceJournalId)) return null;
  const journalId = canonicalJournalId(sourceJournalId);
  const doi = articleDoi(record);
  const officialUrl = String(record.official_url || "");
  const pdfUrl = String(record.pdf_url || "");
  const url = pdfUrl || officialUrl || (doi ? `https://doi.org/${doi}` : "");
  return {
    id: String(record.article_id || ""),
    journal_id: journalId,
    source_journal_id: sourceJournalId,
    journal_name: String(record.journal_name || ""),
    title: String(record.title || ""),
    authors: String(record.authors_text || ""),
    published_at: String(record.published_at || ""),
    issue_date: String(record.issue_date || ""),
    first_seen_at: String(record.first_seen_at || ""),
    display_date: String(record.published_at || record.issue_date || record.first_seen_at || ""),
    display_date_basis: record.published_at ? "published_at" : record.issue_date ? "issue_date" : "first_seen_at",
    push_basis: "first_seen",
    extraction_rule: "shared-metadata-feed",
    url,
    official_url: officialUrl,
    pdf_url: pdfUrl,
    link_status: pdfUrl ? "official_pdf" : officialUrl ? "official_detail" : doi ? "doi_redirect" : "missing",
    link_note: "shared_metadata_feed",
    abstract: String(record.abstract || ""),
    keywords: Array.isArray(record.keywords) ? record.keywords : [],
    identifiers: Array.isArray(record.identifiers) ? record.identifiers : [],
  };
}

export function reconcileSharedFeed(existingArticles = [], records = []) {
  const aliasesToExisting = new Map();
  for (const article of existingArticles) {
    for (const alias of aliases(article)) aliasesToExisting.set(alias, article);
  }
  const representedIds = new Set();
  const articles = records.map(mapSharedFeedRecord).filter(Boolean).map((incoming) => {
    const existing = aliases(incoming).map((alias) => aliasesToExisting.get(alias)).find(Boolean);
    if (!existing) return incoming;
    representedIds.add(existing.id);
    const canonical = { ...incoming, id: existing.id };
    if (linkRank(existing) > linkRank(incoming)) {
      Object.assign(canonical, {
        url: existing.url || "",
        official_url: existing.official_url || "",
        pdf_url: existing.pdf_url || "",
        discovery_url: incoming.discovery_url || existing.discovery_url || "",
        link_status: existing.link_status || "",
        link_note: existing.link_note || "",
      });
    }
    return canonical;
  });
  return {
    articles,
    represented_existing: representedIds.size,
    preserved_existing: existingArticles.length - representedIds.size,
  };
}

async function getJson(fetchImpl, url) {
  const response = await fetchImpl(url, { headers: { accept: "application/json" } });
  if (!response.ok) throw new Error(`Shared Feed request failed: ${response.status} ${url}`);
  return response.json();
}

export async function fetchConsistentSharedFeed(origin, fetchImpl = fetch) {
  const base = origin.replace(/\/$/u, "");
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const before = await getJson(fetchImpl, `${base}/api/feed`);
    if (before.contract_version !== sharedFeedContractVersion) {
      throw new Error(`Unsupported Shared Feed contract: ${before.contract_version}`);
    }
    const records = [];
    let next = `/api/feed/articles?scope=all&limit=500&until=${encodeURIComponent(before.snapshot_at)}`;
    while (next) {
      const page = await getJson(fetchImpl, new URL(next, `${base}/`).toString());
      records.push(...(page.records || []));
      next = page.next;
    }
    const [after, sourceStatus] = await Promise.all([
      getJson(fetchImpl, `${base}/api/feed`),
      getJson(fetchImpl, `${base}/api/feed/sources`),
    ]);
    if (before.dataset_version === after.dataset_version) return { manifest: after, sourceStatus, records, attempt };
  }
  throw new Error("Shared Feed dataset_version changed during both synchronization attempts");
}
