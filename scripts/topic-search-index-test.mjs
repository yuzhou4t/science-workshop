import assert from "node:assert/strict";

import { topicSearchIndexChanged } from "./build-topic-search-index.mjs";
import { buildTopicSearchIndex } from "./topic-search-lib.mjs";

const tagConfig = {
  topics: [
    {
      id: "africa",
      label: "非洲",
      keywords: ["非洲", "Africa", "African", "Uganda", "尼日利亚"],
    },
  ],
  disciplines: [
    {
      id: "management",
      label: "管理学",
      subject_keywords: ["管理学"],
      keywords: ["商业生态系统", "组织", "战略"],
    },
    {
      id: "finance",
      label: "金融",
      subject_keywords: ["BUSINESS,FINANCE"],
      keywords: ["资本市场", "融资", "finance"],
    },
    {
      id: "economics",
      label: "经济学",
      subject_keywords: ["ECONOMICS"],
      keywords: ["risk sharing", "shocks", "economics"],
    },
  ],
};

const articles = [
  {
    id: "title-uganda",
    journal_id: "16",
    journal_name: "AMERICAN ECONOMIC REVIEW",
    title: "Risk Sharing Tests and Covariate Shocks: Drought, Floods, and Pests in Uganda",
    authors: "Demo Author",
    subject: "ECONOMICS",
    url: "https://example.test/uganda",
    first_seen_at: "2026-06-01",
  },
  {
    id: "abstract-nigeria",
    journal_id: "8",
    journal_name: "管理科学学报",
    title: "海外商业生态系统构建机制研究",
    abstract: "本研究选取中国土木工程集团有限公司作为案例分析对象，深入剖析其在尼日利亚构建商业生态系统的过程机制。",
    subject: "管理学",
    first_seen_at: "2026-06-02",
  },
  {
    id: "non-africa",
    journal_id: "1",
    journal_name: "JOURNAL OF FINANCE",
    title: "Liquidity and Corporate Bond Markets",
    abstract: "This paper studies corporate bond liquidity.",
    subject: "BUSINESS,FINANCE",
    first_seen_at: "2026-06-03",
  },
];

const index = buildTopicSearchIndex({ articles, tagConfig, semanticCache: {}, useSemantic: false });

assert.equal(index.summary.total_articles, 3);
assert.equal(index.summary.matched_articles, 2);

const uganda = index.results.find((item) => item.article_id === "title-uganda");
assert.ok(uganda, "title keyword should match Uganda article");
assert.equal(uganda.topic_id, "africa");
assert.equal(uganda.match_mode, "rule");
assert.equal(uganda.match_field, "title");
assert.equal(uganda.disciplines[0].id, "economics");

const nigeria = index.results.find((item) => item.article_id === "abstract-nigeria");
assert.ok(nigeria, "abstract keyword should match Nigeria article");
assert.equal(nigeria.match_field, "abstract");
assert.equal(nigeria.disciplines[0].id, "management");

assert.equal(index.results.some((item) => item.article_id === "non-africa"), false);

const noApiIndex = buildTopicSearchIndex({ articles, tagConfig, semanticCache: {}, useSemantic: true, semanticEnabled: false });
assert.equal(noApiIndex.summary.semantic_enabled, false);
assert.equal(noApiIndex.summary.matched_articles, 2);

assert.equal(
  topicSearchIndexChanged({ ...index, updated_at: "2026-06-01T00:00:00.000Z" }, { ...index, updated_at: "2026-06-02T00:00:00.000Z" }),
  false,
  "timestamp-only topic index changes should not force a rewrite",
);

assert.equal(
  topicSearchIndexChanged(
    { ...index, updated_at: "2026-06-01T00:00:00.000Z" },
    { ...index, summary: { ...index.summary, matched_articles: 1 }, updated_at: "2026-06-02T00:00:00.000Z" },
  ),
  true,
  "meaningful topic index changes should be written",
);

console.log("topic search index ok");
