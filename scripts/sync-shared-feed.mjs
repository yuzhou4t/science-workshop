import { readFile, writeFile } from "node:fs/promises";

import { frontDataFromHistory, mergePushHistory } from "./build-front-data.mjs";
import { dateOnly } from "./recent-workflow-lib.mjs";
import { fetchConsistentSharedFeed, reconcileSharedFeed } from "./shared-feed-sync-lib.mjs";

const root = new URL("..", import.meta.url);
const historyPath = new URL("../data/push-history.json", import.meta.url);
const frontPath = new URL("../data/recent-front-data.js", import.meta.url);
const statePath = new URL("../data/shared-feed-state.json", import.meta.url);
const today = dateOnly(new Date());
const workflowFile = `data/recent-articles-${today}_${today}.json`;
const workflowPath = new URL(`../${workflowFile}`, import.meta.url);
const origin = process.env.SCIENCE_WORKSHOP_SHARED_FEED_ORIGIN || "https://106.53.153.215";

const historyBefore = JSON.parse(await readFile(historyPath, "utf8"));
const synchronized = await fetchConsistentSharedFeed(origin);
const reconciled = reconcileSharedFeed(historyBefore.articles || [], synchronized.records);
const checkedAt = new Date().toISOString();
const relevantStatuses = (synchronized.sourceStatus.sources || []).filter((source) => /^j(?:[1-9]|1\d|2[0-2])$/u.test(source.journal_id));
const workflow = {
  summary: {
    checked_at: checkedAt,
    since: historyBefore.summary?.since || "",
    until: today,
    sources_total: relevantStatuses.length,
    sources_ready: relevantStatuses.filter((source) => source.status === "ready").length,
    ingest_mode: "shared_feed",
    upstream_contract_version: synchronized.manifest.contract_version,
    upstream_dataset_version: synchronized.manifest.dataset_version,
    upstream_data_updated_at: synchronized.manifest.data_updated_at,
    upstream_snapshot_at: synchronized.manifest.snapshot_at,
    sync_completed_at: checkedAt,
  },
  push_queue: reconciled.articles,
};
const history = mergePushHistory(historyBefore, workflow, { workflowFile, updatedAt: checkedAt });
if (history.articles.length < historyBefore.articles.length) throw new Error("Shared Feed synchronization would delete history");
const inserted = history.articles.length - historyBefore.articles.length;
const state = {
  contract_version: synchronized.manifest.contract_version,
  dataset_version: synchronized.manifest.dataset_version,
  upstream_data_updated_at: synchronized.manifest.data_updated_at,
  upstream_snapshot_at: synchronized.manifest.snapshot_at,
  successful_sync_at: checkedAt,
  fetch_attempt: synchronized.attempt,
  counts: {
    received: synchronized.records.length,
    relevant: reconciled.articles.length,
    inserted,
    updated: reconciled.represented_existing,
    preserved: reconciled.preserved_existing,
    total: history.articles.length,
  },
  source_coverage: {
    total: relevantStatuses.length,
    ready: relevantStatuses.filter((source) => source.status === "ready").length,
    checked_at: synchronized.sourceStatus.checked_at || "",
  },
};
const frontData = frontDataFromHistory(history);

await writeFile(workflowPath, `${JSON.stringify(workflow, null, 2)}\n`, "utf8");
await writeFile(historyPath, `${JSON.stringify(history, null, 2)}\n`, "utf8");
await writeFile(frontPath, `window.RECENT_WORKFLOW_DATA = ${JSON.stringify(frontData, null, 2)};\n`, "utf8");
await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ origin, ...state }, null, 2));
