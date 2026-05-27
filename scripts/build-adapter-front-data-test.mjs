import assert from "node:assert/strict";

import { buildAdapterFrontData } from "./build-adapter-front-data.mjs";

const frontData = buildAdapterFrontData({
  version: "test",
  updated_at: "2026-05-27",
  direct_article_feeds: [
    {
      journal_id: "j13",
      journal_name: "ACADEMY OF MANAGEMENT REVIEW",
      feed_url: "https://example.test/rss",
      parser_profile: "atypon-etoc",
    },
  ],
  platform_profiles: [
    {
      id: "ajcass",
      name: "AJCass 社科院平台",
      strategy: "公开 JSON 接口优先",
      render_required: true,
      fields: ["title", "url", "issue", "authors"],
      next_action: "保持接口规则运行。",
    },
  ],
  adapter_queue: [
    {
      journal_id: "j2",
      journal_name: "经济研究",
      platform_id: "ajcass",
      status: "接口规则",
      source_url: "https://erj.ajcass.com/#/index",
      adapter_rule: { kind: "ajcass-current-api", journal_platform_id: 201803050001 },
    },
  ],
});

assert.equal(frontData.summary.direct_article_feeds, 1);
assert.equal(frontData.summary.adapter_sources, 1);
assert.equal(frontData.platform_profiles[0].journals.length, 1);
assert.equal(frontData.adapter_queue[0].status, "接口规则");
assert.equal(frontData.adapter_queue[0].adapter_kind, "ajcass-current-api");
assert.notEqual(frontData.adapter_queue[0].status, "规则待写");

console.log("adapter front data rules ok");
