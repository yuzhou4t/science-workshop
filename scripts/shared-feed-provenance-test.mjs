import assert from "node:assert/strict";
import test from "node:test";
import { frontDataFromHistory, mergePushHistory } from "./build-front-data.mjs";
import { mapSharedFeedRecord, reconcileSharedFeed } from "./shared-feed-sync-lib.mjs";

const pdf = "https://erj.ajcass.com/UploadFile/fixture.pdf";
const discovery = "https://erj.ajcass.com/#/issueDetail?id=123456";
const existing = {
  id: "known-article", journal_id: "j2", source_journal_id: "j2",
  journal_name: "经济研究", title: "Provenance fixture", first_seen_at: "2026-08-01",
  url: pdf, official_url: pdf, pdf_url: pdf,
  discovery_url: discovery, link_status: "official_pdf",
};
const incoming = {
  article_id: existing.id, journal_id: "j2", journal_name: "经济研究",
  title: existing.title, first_seen_at: "2026-08-09",
  official_url: pdf, pdf_url: pdf,
};
const summary = { checked_at: "2026-08-09T03:00:00.000Z", until: "2026-08-09", ingest_mode: "shared_feed" };
const merge = (old, row) => mergePushHistory({ articles: [old] }, { summary, push_queue: [row] });

test("optional discovery provenance from an extended feed is preserved without becoming the click URL", () => {
  const article = mapSharedFeedRecord({ ...incoming, discovery_url: discovery });
  assert.equal(article.discovery_url, discovery);
  assert.equal(article.url, pdf);
});

test("equal-rank shared PDF retains known discovery provenance", () => {
  const [article] = reconcileSharedFeed([existing], [incoming]).articles;
  assert.equal(article.discovery_url, discovery);
  assert.equal(article.pdf_url, pdf);
});

test("a stronger shared PDF does not erase known discovery provenance", () => {
  const detail = { ...existing, url: "https://erj.ajcass.com/article/123456", official_url: "https://erj.ajcass.com/article/123456", pdf_url: "", link_status: "official_detail" };
  const [article] = reconcileSharedFeed([detail], [incoming]).articles;
  assert.equal(article.discovery_url, discovery);
  assert.equal(article.pdf_url, pdf);
});

test("weaker shared link preserves both the official PDF and discovery provenance", () => {
  const [article] = reconcileSharedFeed([existing], [{ ...incoming, official_url: "https://doi.org/10.1000/fixture", pdf_url: "" }]).articles;
  assert.equal(article.discovery_url, discovery);
  assert.equal(article.pdf_url, pdf);
});

test("history merge retains provenance when a resolved incoming record omits it", () => {
  const history = merge(existing, { ...existing, discovery_url: "", first_seen_at: "2026-08-09" });
  assert.equal(history.articles[0].discovery_url, discovery);
  assert.equal(history.articles[0].first_seen_at, "2026-08-01");
});

test("shared-feed to frontend round-trip keeps provenance separate from click URL", () => {
  const [article] = reconcileSharedFeed([existing], [incoming]).articles;
  const front = frontDataFromHistory(merge(existing, article)).push_queue[0];
  assert.equal(front.discovery_url, discovery);
  assert.equal(front.url, pdf);
  assert.equal(front.pdf_url, pdf);
  assert.equal(front.link_status, "official_pdf");
});

test("explicit replacement provenance is accepted without changing the official link", () => {
  const replacement = "https://erj.ajcass.com/#/issueDetail?id=654321";
  const article = merge(existing, { ...existing, discovery_url: replacement }).articles[0];
  assert.equal(article.discovery_url, replacement);
  assert.equal(article.url, pdf);
});

test("new metadata-only records never invent a missing discovery URL", () => {
  const [article] = reconcileSharedFeed([], [incoming]).articles;
  const history = mergePushHistory({ articles: [] }, { summary, push_queue: [article] });
  assert.equal(frontDataFromHistory(history).push_queue[0].discovery_url, "");
});

test("unresolved directory provenance remains non-clickable after an empty update", () => {
  const unresolved = { ...existing, journal_id: "j6", journal_name: "管理世界", url: "", official_url: "", pdf_url: "", discovery_url: "https://www.macrodatas.cn/article/123", extraction_rule: "macrodatas-issue-list", link_status: "needs_official_pdf" };
  const article = merge(unresolved, { ...unresolved, discovery_url: "" }).articles[0];
  assert.equal(article.discovery_url, unresolved.discovery_url);
  assert.equal(article.url, "");
  assert.equal(article.pdf_url, "");
  assert.equal(article.link_status, "needs_official_pdf");
});

test("a shared discovery directory cannot identify a different incoming article", () => {
  const old = { ...existing, id: "old-a", journal_id: "j7", title: "Paper A", url: "", official_url: "", pdf_url: "", discovery_url: "https://www.macrodatas.cn/article/123", link_status: "missing" };
  const record = { ...incoming, article_id: "new-b", journal_id: "j7", title: "Paper B", official_url: "", pdf_url: "", discovery_url: old.discovery_url };
  assert.equal(reconcileSharedFeed([old], [record]).articles[0].id, "new-b");
});

test("discovery URLs never override a title-level identity match", () => {
  const directory = "https://www.macrodatas.cn/article/123";
  const articles = ["A", "B"].map((label) => ({ ...existing, id: `old-${label}`, journal_id: "j7", title: `Paper ${label}`, url: "", official_url: "", pdf_url: "", discovery_url: `${directory}#:~:text=Paper%20${label}`, link_status: "missing" }));
  const record = { ...incoming, article_id: "central-a", journal_id: "j7", title: "Paper A", official_url: "", pdf_url: "", discovery_url: articles[0].discovery_url };
  assert.equal(reconcileSharedFeed(articles, [record]).articles[0].id, "old-A");
});

test("history retains distinct articles that share a directory-only discovery URL", () => {
  const articles = ["A", "B"].map((label) => ({ ...existing, id: `old-${label}`, journal_id: "j7", title: `Paper ${label}`, url: "", official_url: "", pdf_url: "", discovery_url: "https://www.macrodatas.cn/article/123", link_status: "missing" }));
  const history = mergePushHistory({ articles }, { summary, push_queue: [] });
  assert.equal(history.articles.length, 2);
  assert.deepEqual(new Set(history.articles.map((article) => article.id)), new Set(["old-A", "old-B"]));
  assert.ok(history.articles.every((article) => article.url === ""));
});
