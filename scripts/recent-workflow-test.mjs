import assert from "node:assert/strict";

import { buildRecentWorkflow, normalizeWorkflowDate } from "./recent-workflow-lib.mjs";

assert.deepEqual(normalizeWorkflowDate("Fri, 22 May 2026 23:38:25 -0700"), {
  raw: "Fri, 22 May 2026 23:38:25 -0700",
  normalized: "2026-05-23",
  precision: "day",
  status: "known",
});

assert.deepEqual(normalizeWorkflowDate("2026-05-25T12:24:41.616Z"), {
  raw: "2026-05-25T12:24:41.616Z",
  normalized: "2026-05-25",
  precision: "day",
  status: "known",
});

assert.deepEqual(normalizeWorkflowDate("2026-05"), {
  raw: "2026-05",
  normalized: "2026-05",
  precision: "month",
  status: "known",
});

const issueDatedRun = buildRecentWorkflow([
  {
    journal_id: "j-issue",
    journal_name: "期号期刊",
    type: "adapter_source",
    source_url: "https://example.test/issue",
    probe_url: "https://example.test/issue",
    extraction_rule: "issue-rule",
    usable_as_data_source: true,
    articles: [
      { title: "只有期号日期的文章", url: "https://example.test/i1", issue_date: "2026-04", date_source: "url_issue" },
    ],
  },
], {
  since: "2026-04-25",
  until: "2026-05-25",
  checkedAt: "2026-05-25T11:00:00.000Z",
  previousState: {},
});

assert.equal(issueDatedRun.summary.recent_articles, 1);
assert.equal(issueDatedRun.summary.issue_dated_articles, 1);
assert.equal(issueDatedRun.summary.undated_candidates, 0);
assert.equal(issueDatedRun.push_queue[0].push_basis, "issue_date");
assert.equal(issueDatedRun.push_queue[0].issue_date, "2026-04");
assert.equal(issueDatedRun.push_queue[0].display_date, "2026-04");
assert.equal(issueDatedRun.push_queue[0].display_date_basis, "issue_date");

const futureIssueRun = buildRecentWorkflow([
  {
    journal_id: "j-future",
    journal_name: "未来期号期刊",
    type: "adapter_source",
    source_url: "https://example.test/future",
    probe_url: "https://example.test/future",
    extraction_rule: "future-rule",
    usable_as_data_source: true,
    articles: [
      { title: "提前上线的未来期号文章", url: "https://example.test/future-i1", issue_date: "2026-06", date_source: "context_issue" },
    ],
  },
], {
  since: "2026-04-25",
  until: "2026-05-25",
  checkedAt: "2026-05-25T11:15:00.000Z",
  previousState: {},
});

assert.equal(futureIssueRun.summary.recent_articles, 1);
assert.equal(futureIssueRun.summary.issue_dated_articles, 1);
assert.equal(futureIssueRun.summary.push_queue_articles, 1);
assert.equal(futureIssueRun.push_queue[0].push_basis, "issue_date");
assert.equal(futureIssueRun.push_queue[0].inclusion_reason, "future_issue_first_seen");

const canonicalJournalRun = buildRecentWorkflow([
  {
    journal_id: "j14",
    journal_name: "JOURNAL OF FINANCE",
    type: "direct_feed",
    source_url: "https://onlinelibrary.wiley.com/action/showFeed?jc=15406261&type=etoc&feed=rss",
    probe_url: "https://onlinelibrary.wiley.com/action/showFeed?jc=15406261&type=etoc&feed=rss",
    extraction_rule: "wiley-etoc",
    usable_as_data_source: true,
    articles: [
      { title: "同一篇 JOF 文章", url: "https://onlinelibrary.wiley.com/doi/10.1111/jofi.70055", date: "2026-05-20" },
    ],
  },
  {
    journal_id: "j1",
    journal_name: "JOURNAL OF FINANCE",
    type: "adapter_source",
    source_url: "https://afajof.org/forthcoming-articles/",
    probe_url: "https://afajof.org/forthcoming-articles/",
    extraction_rule: "afa-forthcoming-doi",
    usable_as_data_source: true,
    articles: [
      { title: "同一篇 JOF 文章", url: "https://onlinelibrary.wiley.com/doi/10.1111/jofi.70055", date: "" },
    ],
  },
], {
  since: "2026-04-25",
  until: "2026-05-25",
  checkedAt: "2026-05-25T11:30:00.000Z",
  previousState: {},
});

assert.equal(canonicalJournalRun.push_queue.length, 1);
assert.equal(canonicalJournalRun.push_queue[0].journal_id, "j14");
assert.equal(canonicalJournalRun.push_queue[0].source_journal_id, "j14");
assert.equal(canonicalJournalRun.summary.push_queue_articles, 1);

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
      { title: "窗口外文章", url: "https://example.test/a3", published_at: "2026-03-01", authors: "C" },
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
  issue_dated_articles: 1,
  new_undated_articles: 1,
  undated_candidates: 1,
  push_queue_articles: 3,
});
assert.deepEqual(firstRun.recent_articles.map((article) => article.title), ["窗口内文章", "月份级文章"]);
assert.deepEqual(firstRun.undated_candidates.map((article) => article.title), ["无日期文章"]);
assert.deepEqual(new Set(firstRun.push_queue.map((article) => article.title)), new Set(["窗口内文章", "月份级文章", "无日期文章"]));
assert.equal(firstRun.push_queue.find((article) => article.title === "窗口内文章").push_basis, "published_date");
assert.equal(firstRun.push_queue.find((article) => article.title === "月份级文章").push_basis, "issue_date");
assert.equal(firstRun.push_queue.find((article) => article.title === "无日期文章").push_basis, "first_seen");
assert.equal(firstRun.push_queue.find((article) => article.title === "窗口外文章"), undefined);

const secondRun = buildRecentWorkflow(probeResults, {
  since: "2026-04-25",
  until: "2026-05-25",
  checkedAt: "2026-05-25T12:30:00.000Z",
  previousState: firstRun.source_state,
});

assert.equal(secondRun.summary.new_recent_articles, 0);
assert.equal(secondRun.summary.new_undated_articles, 0);
assert.equal(secondRun.summary.push_queue_articles, 0);
assert.ok(secondRun.recent_articles.every((article) => article.is_new === false));
assert.equal(secondRun.recent_articles.find((article) => article.title === "窗口内文章").first_seen_at, "2026-05-25");
assert.equal(firstRun.source_state.first_seen_by_id[firstRun.push_queue.find((article) => article.title === "窗口内文章").id], "2026-05-25");

const legacyStateRun = buildRecentWorkflow(probeResults, {
  since: "2026-04-25",
  until: "2026-05-25",
  checkedAt: "2026-05-26T10:00:00.000Z",
  previousState: {
    checked_at: "2026-05-25T12:00:00.000Z",
    article_ids: firstRun.source_state.article_ids,
  },
});

assert.equal(legacyStateRun.recent_articles.find((article) => article.title === "窗口内文章").first_seen_at, "2026-05-25");

const forcedPushRun = buildRecentWorkflow(probeResults, {
  since: "2026-04-25",
  until: "2026-05-25",
  checkedAt: "2026-05-26T10:00:00.000Z",
  previousState: firstRun.source_state,
  forcePushAll: true,
});

assert.equal(forcedPushRun.summary.push_queue_articles, 3);
assert.equal(forcedPushRun.push_queue.find((article) => article.title === "窗口内文章").first_seen_at, "2026-05-25");
assert.equal(forcedPushRun.push_queue.find((article) => article.title === "无日期文章").first_seen_at, "2026-05-25");

const baselineRun = buildRecentWorkflow(probeResults, {
  since: "2026-04-25",
  until: "2026-05-25",
  checkedAt: "2026-05-25T12:45:00.000Z",
  previousState: {},
  baseline: true,
});

assert.equal(baselineRun.summary.new_recent_articles, 0);
assert.equal(baselineRun.summary.new_undated_articles, 0);
assert.equal(baselineRun.summary.push_queue_articles, 0);
assert.ok(baselineRun.source_state.article_ids.length > 0);

console.log("recent workflow rules ok");
