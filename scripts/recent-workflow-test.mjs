import assert from "node:assert/strict";

import { buildRecentWorkflow, normalizeWorkflowDate } from "./recent-workflow-lib.mjs";

assert.deepEqual(normalizeWorkflowDate("Fri, 22 May 2026 23:38:25 -0700"), {
  raw: "Fri, 22 May 2026 23:38:25 -0700",
  normalized: "2026-05-23",
  precision: "day",
  status: "known",
});

assert.deepEqual(normalizeWorkflowDate("2026-05"), {
  raw: "2026-05",
  normalized: "2026-05",
  precision: "month",
  status: "known",
});

const probeResults = [
  {
    journal_id: "j-test",
    journal_name: "测试期刊",
    type: "adapter_source",
    source_url: "https://example.test/journal",
    probe_url: "https://example.test/current",
    extraction_rule: "test-rule",
    usable_as_data_source: true,
    articles: [
      { title: "窗口内文章", url: "https://example.test/a1", date: "2026-05-10", authors: "A" },
      { title: "月份级文章", url: "https://example.test/a2", date: "2026-05", authors: "B" },
      { title: "窗口外文章", url: "https://example.test/a3", date: "2026-03-01", authors: "C" },
      { title: "无日期文章", url: "https://example.test/a4", date: "", authors: "D" },
    ],
  },
];

const firstRun = buildRecentWorkflow(probeResults, {
  since: "2026-04-25",
  until: "2026-05-25",
  checkedAt: "2026-05-25T12:00:00.000Z",
  previousState: {},
});

assert.deepEqual(firstRun.summary, {
  checked_at: "2026-05-25T12:00:00.000Z",
  since: "2026-04-25",
  until: "2026-05-25",
  sources_total: 1,
  sources_ready: 1,
  recent_articles: 2,
  new_recent_articles: 2,
  undated_candidates: 1,
});
assert.deepEqual(firstRun.recent_articles.map((article) => article.title), ["窗口内文章", "月份级文章"]);
assert.deepEqual(firstRun.undated_candidates.map((article) => article.title), ["无日期文章"]);

const secondRun = buildRecentWorkflow(probeResults, {
  since: "2026-04-25",
  until: "2026-05-25",
  checkedAt: "2026-05-25T12:30:00.000Z",
  previousState: firstRun.source_state,
});

assert.equal(secondRun.summary.new_recent_articles, 0);
assert.ok(secondRun.recent_articles.every((article) => article.is_new === false));

console.log("recent workflow rules ok");
