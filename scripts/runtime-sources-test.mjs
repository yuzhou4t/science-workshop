import assert from "node:assert/strict";
import { mergeRuntimeSources, normalizeApprovedRuntimeSource } from "./runtime-sources.mjs";

const registry = {
  direct_article_feeds: [{ journal_id: "j1", feed_url: "https://existing.test/feed" }],
  adapter_queue: [{ journal_id: "j2", source_url: "https://existing.test/journal" }],
};

const feed = normalizeApprovedRuntimeSource({
  request_id: "r-feed",
  status: "approved",
  journal_name: "社区期刊",
  feed_url: "https://community.test/rss.xml",
  candidate_type: "RSS / Atom",
});
assert.equal(feed.journal_id, "community-r-feed");
assert.equal(feed.feed_url, "https://community.test/rss.xml");

assert.equal(normalizeApprovedRuntimeSource({ status: "pending_auto_probe", feed_url: "https://x.test/rss" }), null);
assert.equal(normalizeApprovedRuntimeSource({ status: "approved", feed_url: "http://127.0.0.1/rss" }).feed_url, "http://127.0.0.1/rss", "SSRF is enforced before approval, not by the merge loader");

const merged = mergeRuntimeSources(registry, {
  sources: [
    { request_id: "r-feed", status: "approved", journal_name: "社区期刊", feed_url: "https://community.test/rss.xml", candidate_type: "RSS / Atom" },
    { request_id: "r-html", decision: "approved", journal_name: "开放元数据期刊", homepage_url: "https://community.test/journal", candidate_type: "OpenAlex metadata" },
    { request_id: "r-pending", status: "pending_auto_probe", journal_name: "不应上线", feed_url: "https://community.test/pending.xml", candidate_type: "RSS" },
    { request_id: "r-duplicate", status: "approved", journal_name: "重复", feed_url: "https://existing.test/feed", candidate_type: "RSS" },
  ],
});
assert.equal(merged.direct_article_feeds.length, 2);
assert.equal(merged.adapter_queue.length, 2);
assert.equal(merged.runtime_sources_loaded, 2);
assert.equal(merged.direct_article_feeds.at(-1).runtime_source, true);
assert.equal(merged.adapter_queue.at(-1).platform_id, "community-open-metadata");
assert.equal(merged.adapter_queue.at(-1).adapter_rule.kind, "open-metadata-runtime");

console.log("runtime source merge tests passed");
