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
      abstract: "目录页补到的摘要",
      keywords: ["目录", "摘要"],
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
assert.equal(history.articles.find((article) => article.id === "fallback-1").abstract, "目录页补到的摘要");
assert.deepEqual(history.articles.find((article) => article.id === "fallback-1").keywords, ["目录", "摘要"]);
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
assert.equal(frontData.push_queue.find((article) => article.id === "fallback-1").abstract, "目录页补到的摘要");
assert.deepEqual(frontData.push_queue.find((article) => article.id === "fallback-1").keywords, ["目录", "摘要"]);

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

const abstractBackfillHistory = mergePushHistory(
  {
    version: 1,
    summary: {
      new_push_queue_articles: 7,
      last_workflow_file: "data/recent-articles-2026-05-31_2026-05-31.json",
    },
    articles: [
      {
        id: "abstract-date-1",
        journal_id: "j8",
        journal_name: "公共管理学报",
        title: "只需要补摘要的文章",
        url: "https://example.test/detail",
        published_at: "2026-05-29",
        issue_date: "",
        display_date: "2026-05-29",
        display_date_basis: "published_at",
        first_seen_at: "2026-05-31",
      },
    ],
  },
  {
    summary: {
      checked_at: "2026-06-06T02:00:00.000Z",
      sources_total: 1,
      sources_ready: 1,
      push_queue_articles: 1,
      abstract_backfill: true,
    },
    push_queue: [
      {
        id: "abstract-date-1",
        journal_id: "j8",
        journal_name: "公共管理学报",
        title: "只需要补摘要的文章",
        url: "https://example.test/detail",
        published_at: "",
        issue_date: "2022-04",
        display_date: "2022-04",
        display_date_basis: "issue_date",
        first_seen_at: "2026-06-06",
        abstract: "这是稍后从详情页补到的摘要。",
        keywords: ["摘要回填"],
      },
    ],
  },
);

const abstractBackfillArticle = abstractBackfillHistory.articles[0];
assert.equal(abstractBackfillArticle.published_at, "2026-05-29");
assert.equal(abstractBackfillArticle.issue_date, "");
assert.equal(abstractBackfillArticle.display_date, "2026-05-29");
assert.equal(abstractBackfillArticle.display_date_basis, "published_at");
assert.equal(abstractBackfillArticle.abstract, "这是稍后从详情页补到的摘要。");
assert.deepEqual(abstractBackfillArticle.keywords, ["摘要回填"]);
assert.equal(abstractBackfillHistory.summary.new_push_queue_articles, 7);
assert.equal(abstractBackfillHistory.summary.last_workflow_file, "data/recent-articles-2026-05-31_2026-05-31.json");

const preservedAbstractHistory = mergePushHistory(
  {
    version: 1,
    articles: [
      {
        id: "verified-abstract-1",
        journal_id: "j17",
        journal_name: "JOURNAL OF POLITICAL ECONOMY",
        title: "已经有正式出版社摘要的文章",
        url: "https://example.test/verified",
        first_seen_at: "2026-05-31",
        abstract: "这是已经核验过的正式出版社摘要。",
      },
    ],
  },
  {
    summary: {
      checked_at: "2026-06-06T02:00:00.000Z",
      sources_total: 1,
      sources_ready: 1,
      push_queue_articles: 1,
      abstract_backfill: true,
    },
    push_queue: [
      {
        id: "verified-abstract-1",
        journal_id: "j17",
        journal_name: "JOURNAL OF POLITICAL ECONOMY",
        title: "已经有正式出版社摘要的文章",
        url: "https://example.test/verified",
        first_seen_at: "2026-06-06",
        abstract: "这是后来元数据源返回的工作论文长版，不应覆盖已有摘要。",
      },
    ],
  },
);

assert.equal(preservedAbstractHistory.articles[0].abstract, "这是已经核验过的正式出版社摘要。");

const officialLinkBackfillHistory = mergePushHistory(
  {
    version: 1,
    summary: {
      new_push_queue_articles: 3,
      last_workflow_file: "data/recent-articles-2026-06-01_2026-06-01.json",
    },
    articles: [
      {
        id: "nankai-link-1",
        journal_id: "j12",
        journal_name: "南开管理评论",
        title: "等待正式链接的文章",
        discovery_url: "https://example.test/discovery",
        link_status: "needs_official_pdf",
        first_seen_at: "2026-06-01",
      },
    ],
  },
  {
    summary: {
      checked_at: "2026-06-06T03:00:00.000Z",
      sources_total: 22,
      sources_ready: 18,
      push_queue_articles: 1,
      nankai_official_link_backfill: true,
    },
    push_queue: [
      {
        id: "nankai-link-1",
        journal_id: "j12",
        journal_name: "南开管理评论",
        title: "等待正式链接的文章",
        url: "https://www.ncpssd.cn/Literature/articleinfo?id=demo",
        official_url: "https://www.ncpssd.cn/Literature/articleinfo?id=demo",
        link_status: "official_detail",
        first_seen_at: "2026-06-01",
      },
    ],
  },
  { workflowFile: "data/recent-articles-nankai-official-links-alt.json" },
);

assert.equal(officialLinkBackfillHistory.articles[0].link_status, "official_detail");
assert.equal(officialLinkBackfillHistory.summary.new_push_queue_articles, 3);
assert.equal(officialLinkBackfillHistory.summary.last_workflow_file, "data/recent-articles-2026-06-01_2026-06-01.json");

console.log("front data history rules ok");
