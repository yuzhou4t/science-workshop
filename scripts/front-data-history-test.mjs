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
    {
      id: "resolved-1",
      journal_id: "j10",
      journal_name: "已解析期刊",
      title: "已经补好官方详情的文章",
      url: "https://www.ncpssd.org/Literature/articleinfo?id=demo",
      official_url: "https://www.ncpssd.org/Literature/articleinfo?id=demo",
      discovery_url: "https://www.cqvip.com/doc/journal/123?sign=old",
      link_status: "official_detail",
      authors: "A",
      first_seen_at: "2026-05-27",
      display_date: "2026-05-27",
      push_basis: "first_seen",
      extraction_rule: "cqvip-journal-html",
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
    {
      id: "fallback-1",
      journal_id: "j6",
      journal_name: "兜底期刊",
      title: "目录页发现但未解析官方 PDF 的文章",
      url: "https://www.macrodatas.cn/article/1779681420#:~:text=%E7%9B%AE%E5%BD%95",
      extraction_rule: "macrodatas-issue-list",
      authors: "A",
      first_seen_at: "2026-05-28",
      display_date: "2026-05-28",
      push_basis: "first_seen",
    },
    {
      id: "resolved-1",
      journal_id: "j10",
      journal_name: "已解析期刊",
      title: "已经补好官方详情的文章",
      url: "https://www.cqvip.com/doc/journal/123?sign=new",
      extraction_rule: "cqvip-journal-html",
      authors: "",
      first_seen_at: "2026-05-28",
      display_date: "2026-05-28",
      push_basis: "first_seen",
    },
    {
      id: "paid-1",
      journal_id: "j6",
      journal_name: "管理世界",
      title: "已经补好知网付费详情的文章",
      url: "https://kns.cnki.net/kcms/detail/detail.aspx?dbcode=CJFD&filename=GLSJ202605008",
      official_url: "https://kns.cnki.net/kcms/detail/detail.aspx?dbcode=CJFD&filename=GLSJ202605008",
      discovery_url: "https://www.macrodatas.cn/article/1779681420#:~:text=demo",
      link_status: "official_paid_detail",
      access_model: "paid",
      official_source: "cnki",
      authors: "A",
      first_seen_at: "2026-05-27",
      display_date: "2026-05-27",
      push_basis: "first_seen",
      extraction_rule: "macrodatas-issue-list",
    },
  ],
};

const history = mergePushHistory(existingHistory, workflow, {
  workflowFile: "data/recent-articles-2026-05-28_2026-05-28.json",
});

assert.equal(history.articles.length, 5);
assert.deepEqual([...history.articles.map((article) => article.id)].sort(), ["fallback-1", "new-1", "old-1", "paid-1", "resolved-1"]);
assert.equal(history.articles.find((article) => article.id === "old-1").first_seen_at, "2026-05-27");
assert.equal(history.articles.find((article) => article.id === "old-1").authors, "补全作者");
assert.equal(history.articles.find((article) => article.id === "fallback-1").url, "");
assert.equal(history.articles.find((article) => article.id === "fallback-1").link_status, "needs_official_pdf");
assert.equal(history.articles.find((article) => article.id === "fallback-1").discovery_url.includes("macrodatas.cn/article/1779681420"), true);
assert.equal(history.articles.find((article) => article.id === "resolved-1").url, "https://www.ncpssd.org/Literature/articleinfo?id=demo");
assert.equal(history.articles.find((article) => article.id === "resolved-1").link_status, "official_detail");
assert.equal(history.articles.find((article) => article.id === "resolved-1").discovery_url.includes("cqvip.com/doc/journal/123"), true);
assert.equal(history.articles.find((article) => article.id === "paid-1").link_status, "official_paid_detail");
assert.equal(history.articles.find((article) => article.id === "paid-1").access_model, "paid");
assert.equal(history.articles.find((article) => article.id === "paid-1").official_source, "cnki");
assert.equal(history.summary.history_articles, 5);
assert.equal(history.summary.last_workflow_file, "data/recent-articles-2026-05-28_2026-05-28.json");

const frontData = frontDataFromHistory(history);
assert.equal(frontData.summary.push_queue_articles, 5);
assert.deepEqual([...frontData.push_queue.map((article) => article.id)].sort(), ["fallback-1", "new-1", "old-1", "paid-1", "resolved-1"]);
assert.equal(frontData.push_queue.find((article) => article.id === "paid-1").link_status, "official_paid_detail");

const dedupedHistory = mergePushHistory(
  {
    version: 1,
    articles: [
      {
        id: "cqvip-old-a",
        journal_id: "j10",
        journal_name: "中国行政管理",
        title: "同一篇维普发现文章",
        discovery_url: "https://www.cqvip.com/doc/journal/7203343027?sign=aaa&expireTime=1&resourceId=7203343027&type=1",
        extraction_rule: "cqvip-journal-html",
        first_seen_at: "2026-05-27",
      },
      {
        id: "cqvip-old-b",
        journal_id: "j10",
        journal_name: "中国行政管理",
        title: "同一篇维普发现文章",
        discovery_url: "https://www.cqvip.com/doc/journal/7203343027?sign=bbb&expireTime=2&resourceId=7203343027&type=1",
        extraction_rule: "cqvip-journal-html",
        first_seen_at: "2026-05-26",
      },
    ],
  },
  {
    summary: { checked_at: "2026-05-28T02:00:00.000Z", sources_total: 1, sources_ready: 1, push_queue_articles: 0 },
    push_queue: [],
  },
);

assert.equal(dedupedHistory.articles.length, 1);
assert.equal(dedupedHistory.articles[0].id, "cqvip-old-a");
assert.equal(dedupedHistory.articles[0].first_seen_at, "2026-05-26");

console.log("front data history rules ok");
