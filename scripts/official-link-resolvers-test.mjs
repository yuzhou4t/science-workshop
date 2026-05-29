import assert from "node:assert/strict";

import {
  compactArticleTitle,
  parseNcpssdIssueArticles,
  resolveNcpssdArticle,
} from "./official-link-resolvers.mjs";

const ncpssdIssueSnippet = `
  <div class="result-list">
    <a onclick="openDetail('/Literature/articleinfo?id=ZGXZGL2026003003&type=journalArticle&typename=中文期刊文章&nav=1&langType=1')"
       title='“钉钉子”的技术：重大决策落实的工作机制'>
      “钉钉子”的技术：重大决策落实的工作机制
    </a>
    <a onclick="ViewHandleCount(this, '中文期刊文章', 'ZGXZGL2026003003', -1, 1, '/Literature/readurl?id=ZGXZGL2026003003', '81961X', '[D035]', '“钉钉子”的技术：重大决策落实的工作机制', '庞明礼[1,2];郭雯斐[3]','中国行政管理','')">
      阅读全文
    </a>
  </div>
`;

assert.equal(
  compactArticleTitle("“钉钉子”的技术: 重大决策落实的工作机制"),
  compactArticleTitle("“钉钉子”的技术：重大决策落实的工作机制"),
);

const articles = parseNcpssdIssueArticles(ncpssdIssueSnippet, "https://www.ncpssd.org/journal/secure/details?params=demo");

assert.equal(articles.length, 1);
assert.equal(articles[0].id, "ZGXZGL2026003003");
assert.equal(articles[0].title, "“钉钉子”的技术：重大决策落实的工作机制");
assert.equal(articles[0].authors, "庞明礼; 郭雯斐");
assert.equal(
  articles[0].official_url,
  "https://www.ncpssd.org/Literature/articleinfo?id=ZGXZGL2026003003&type=journalArticle&typename=%E4%B8%AD%E6%96%87%E6%9C%9F%E5%88%8A%E6%96%87%E7%AB%A0&nav=1&langType=1",
);
assert.equal(articles[0].reader_url, "https://www.ncpssd.org/Literature/readurl?id=ZGXZGL2026003003");

const resolved = resolveNcpssdArticle(
  { title: "“钉钉子”的技术:重大决策落实的工作机制" },
  articles,
);

assert.equal(resolved.official_url, articles[0].official_url);
assert.equal(resolved.authors, "庞明礼; 郭雯斐");

console.log("official link resolver rules ok");
