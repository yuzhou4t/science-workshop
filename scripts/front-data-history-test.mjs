import assert from "node:assert/strict";

import { frontDataFromHistory, mergePushHistory } from "./build-front-data.mjs";

const existingHistory = {
  version: 1,
  articles: [
    {
      id: "old-1",
      journal_id: "j1",
      journal_name: "旧期刊",
      title: "已经推送过的文章",
      url: "https://example.test/old-1",
      authors: "",
      first_seen_at: "2026-05-27",
      display_date: "2026-05-27",
      push_basis: "first_seen",
    },
  ],
};

const workflow = {
  summary: {
    checked_at: "2026-05-28T02:00:00.000Z",
    since: "2026-05-28",
    until: "2026-05-28",
    sources_total: 2,
    sources_ready: 2,
    push_queue_articles: 2,
  },
  push_queue: [
    {
      id: "old-1",
      journal_id: "j1",
      journal_name: "旧期刊",
      title: "已经推送过的文章",
      url: "https://example.test/old-1",
      authors: "补全作者",
      first_seen_at: "2026-05-28",
      display_date: "2026-05-28",
      push_basis: "first_seen",
    },
    {
      id: "new-1",
      journal_id: "j2",
      journal_name: "新期刊",
      title: "今天新发现的文章",
      url: "https://example.test/new-1",
      authors: "A",
      first_seen_at: "2026-05-28",
      display_date: "2026-05-28",
      push_basis: "first_seen",
    },
  ],
};

const history = mergePushHistory(existingHistory, workflow, {
  workflowFile: "data/recent-articles-2026-05-28_2026-05-28.json",
});

assert.equal(history.articles.length, 2);
assert.deepEqual(history.articles.map((article) => article.id), ["new-1", "old-1"]);
assert.equal(history.articles.find((article) => article.id === "old-1").first_seen_at, "2026-05-27");
assert.equal(history.articles.find((article) => article.id === "old-1").authors, "补全作者");
assert.equal(history.summary.history_articles, 2);
assert.equal(history.summary.last_workflow_file, "data/recent-articles-2026-05-28_2026-05-28.json");

const frontData = frontDataFromHistory(history);
assert.equal(frontData.summary.push_queue_articles, 2);
assert.deepEqual(frontData.push_queue.map((article) => article.id), ["new-1", "old-1"]);

console.log("front data history rules ok");
