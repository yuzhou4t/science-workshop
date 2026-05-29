import assert from "node:assert/strict";

import { normalizeArticleLink } from "./article-link-policy.mjs";

const macrodatasLink = normalizeArticleLink(
  { extraction_rule: "macrodatas-issue-list" },
  {
    title: "目录页中的文章",
    url: "https://www.macrodatas.cn/article/1779681420#:~:text=%E7%9B%AE%E5%BD%95",
  },
);

assert.equal(macrodatasLink.url, "");
assert.equal(macrodatasLink.discovery_url, "https://www.macrodatas.cn/article/1779681420#:~:text=%E7%9B%AE%E5%BD%95");
assert.equal(macrodatasLink.link_status, "needs_official_pdf");

const cqvipLink = normalizeArticleLink(
  { extraction_rule: "cqvip-journal-html" },
  {
    title: "维普目录中的文章",
    url: "https://www.cqvip.com/doc/journal/7203343027?sign=aaa&expireTime=1795485812689&resourceId=7203343027&type=1",
  },
);

assert.equal(cqvipLink.url, "");
assert.equal(cqvipLink.discovery_url.includes("cqvip.com/doc/journal/7203343027"), true);
assert.equal(cqvipLink.link_status, "needs_official_pdf");

const resolvedCqvipLink = normalizeArticleLink(
  { extraction_rule: "cqvip-journal-html" },
  {
    title: "已解析官方详情的维普发现文章",
    url: "https://www.cqvip.com/doc/journal/7203343027?sign=aaa&expireTime=1795485812689&resourceId=7203343027&type=1",
    official_url: "https://www.ncpssd.org/Literature/articleinfo?id=ZGXZGL2026003003&type=journalArticle&typename=%E4%B8%AD%E6%96%87%E6%9C%9F%E5%88%8A%E6%96%87%E7%AB%A0&nav=1&langType=1",
  },
);

assert.equal(
  resolvedCqvipLink.url,
  "https://www.ncpssd.org/Literature/articleinfo?id=ZGXZGL2026003003&type=journalArticle&typename=%E4%B8%AD%E6%96%87%E6%9C%9F%E5%88%8A%E6%96%87%E7%AB%A0&nav=1&langType=1",
);
assert.equal(resolvedCqvipLink.discovery_url.includes("cqvip.com/doc/journal/7203343027"), true);
assert.equal(resolvedCqvipLink.link_status, "official_detail");

const officialLink = normalizeArticleLink(
  { extraction_rule: "aea-forthcoming-html" },
  {
    title: "官方平台文章",
    url: "https://www.aeaweb.org/articles?id=10.1257%2Faer.20250064",
  },
);

assert.equal(officialLink.url, "https://www.aeaweb.org/articles?id=10.1257%2Faer.20250064");
assert.equal(officialLink.official_url, "https://www.aeaweb.org/articles?id=10.1257%2Faer.20250064");
assert.equal(officialLink.link_status, "official_detail");

console.log("article link policy rules ok");
