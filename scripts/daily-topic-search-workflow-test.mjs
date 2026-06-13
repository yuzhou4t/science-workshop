import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const workflowSource = await readFile(new URL("./run-daily-workflow.mjs", import.meta.url), "utf8");
const publishSource = await readFile(new URL("./run-daily-publish.mjs", import.meta.url), "utf8");

const frontDataStep = workflowSource.indexOf("scripts/build-front-data.mjs");
const abstractBackfillStep = workflowSource.indexOf("scripts/backfill-daily-abstracts.mjs");
const topicSearchStep = workflowSource.indexOf("scripts/build-topic-search-index.mjs");

assert.notEqual(topicSearchStep, -1, "daily workflow should refresh the topic search index");
assert.ok(topicSearchStep > frontDataStep, "topic search index should refresh after front data is merged");
assert.ok(topicSearchStep > abstractBackfillStep, "topic search index should refresh after abstract backfill");
assert.match(publishSource, /"data\/topic-search-index\.js"/, "daily publish should include topic search index");

console.log("daily topic search workflow rules ok");
