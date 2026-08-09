import assert from "node:assert/strict";

import { mergePushHistory } from "./build-front-data.mjs";
import {
  fetchConsistentSharedFeed,
  mapSharedFeedRecord,
  reconcileSharedFeed,
} from "./shared-feed-sync-lib.mjs";

const existing = [{
  id: "science-aer-id",
  journal_id: "j16",
  source_journal_id: "j16",
  journal_name: "AMERICAN ECONOMIC REVIEW",
  title: "Same AER Paper",
  first_seen_at: "2026-08-06",
  official_url: "https://www.aeaweb.org/articles?id=10.1257/aer.1",
  url: "https://www.aeaweb.org/articles?id=10.1257/aer.1",
  link_status: "official_detail",
}];

const records = [{
  article_id: "central-aer-id",
  journal_id: "j16",
  journal_name: "AMERICAN ECONOMIC REVIEW",
  title: "Same AER Paper",
  first_seen_at: "2026-08-08",
  official_url: "https://doi.org/10.1257/aer.1",
  identifiers: [{ type: "doi", value: "10.1257/aer.1" }],
}, {
  article_id: "historical-asq",
  journal_id: "j22",
  journal_name: "ADMINISTRATIVE SCIENCE QUARTERLY",
  title: "Historical ASQ Paper",
  first_seen_at: "2026-07-01",
  official_url: "https://journals.sagepub.com/doi/10.1177/1",
}, {
  article_id: "outside-scope",
  journal_id: "j23",
  title: "Do not ingest",
  first_seen_at: "2026-08-09",
}];

const reconciled = reconcileSharedFeed(existing, records);
assert.equal(reconciled.articles.length, 2);
assert.equal(reconciled.articles[0].id, "science-aer-id");
assert.equal(reconciled.articles[0].first_seen_at, "2026-08-08");
assert.equal(reconciled.articles[0].official_url, existing[0].official_url);
assert.equal(mapSharedFeedRecord({ ...records[1], journal_id: "j1" }).journal_id, "j14");

const history = mergePushHistory({ version: 1, articles: existing }, {
  summary: {
    checked_at: "2026-08-09T03:00:00.000Z",
    until: "2026-08-09",
    sources_total: 22,
    sources_ready: 22,
    ingest_mode: "shared_feed",
    upstream_dataset_version: "v1",
  },
  push_queue: reconciled.articles,
});
assert.equal(history.articles.length, 2);
assert.equal(history.articles.find((article) => article.id === "science-aer-id").first_seen_at, "2026-08-06");
assert.equal(history.summary.new_push_queue_articles, 0);
assert.equal(history.summary.ingest_mode, "shared_feed");

function mockResponse(body) {
  return { ok: true, json: async () => body };
}

let manifestReads = 0;
const fetched = await fetchConsistentSharedFeed("https://feed.test", async (url) => {
  if (url.endsWith("/api/feed")) {
    manifestReads += 1;
    const version = manifestReads <= 2 ? (manifestReads === 1 ? "changed-a" : "changed-b") : "stable";
    return mockResponse({
      contract_version: "metadata-feed/1.0.0",
      dataset_version: version,
      snapshot_at: "2026-08-09T01:00:00.000Z",
      data_updated_at: "2026-08-09T01:00:00.000Z",
    });
  }
  if (url.endsWith("/api/feed/sources")) {
    return mockResponse({ contract_version: "metadata-source-status/1.0.0", sources: [] });
  }
  return mockResponse({ records: [], next: null });
});
assert.equal(fetched.attempt, 2);
assert.equal(fetched.manifest.dataset_version, "stable");

let alwaysChanging = 0;
await assert.rejects(
  fetchConsistentSharedFeed("https://feed.test", async (url) => {
    if (url.endsWith("/api/feed")) {
      alwaysChanging += 1;
      return mockResponse({
        contract_version: "metadata-feed/1.0.0",
        dataset_version: `v${alwaysChanging}`,
        snapshot_at: "2026-08-09T01:00:00.000Z",
      });
    }
    if (url.endsWith("/api/feed/sources")) return mockResponse({ sources: [] });
    return mockResponse({ records: [], next: null });
  }),
  /changed during both/u,
);

console.log("shared feed sync tests passed");
