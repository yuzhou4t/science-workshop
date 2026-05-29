import assert from "node:assert/strict";

import {
  compactArticleTitle,
  parseNcpssdIssueArticles,
  resolveCnkiSequentialArticles,
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

const ncpssdMobileSnippetWithTypeArg = `
  <div class="result-list">
    <a onclick="openDetail('/Literature/articleinfo?id=NKGLPL2026002003&type=journalArticle&typename=中文期刊文章&nav=1&langType=1','中文期刊文章')"
       title='技术集群先导平台企业如何助力关键核心技术突破——一项光电产业的探索性案例研究'>
      技术集群先导平台企业如何助力关键核心技术突破——一项光电产业的探索性案例研究
    </a>
    <a onclick="AddHandleCount(this, '中文期刊文章', 'NKGLPL2026002003', 1, -1, '/Literature/readurl?id=NKGLPL2026002003', '81584X', '[F426.6, F273.1]', '技术集群先导平台企业如何助力关键核心技术突破——一项光电产业的探索性案例研究', '李梦雅[1];杨德林[2];邹济[2];郝晨[3];李浩[4]', '南开管理评论')">
      下载全文&gt;&gt;
    </a>
  </div>
`;

const mobileArticles = parseNcpssdIssueArticles(ncpssdMobileSnippetWithTypeArg, "https://m.ncpssd.cn/journal/details?gch=81584X");

assert.equal(mobileArticles.length, 1);
assert.equal(mobileArticles[0].id, "NKGLPL2026002003");
assert.equal(mobileArticles[0].authors, "李梦雅; 杨德林; 邹济; 郝晨; 李浩");
assert.equal(
  mobileArticles[0].official_url,
  "https://m.ncpssd.cn/Literature/articleinfo?id=NKGLPL2026002003&type=journalArticle&typename=%E4%B8%AD%E6%96%87%E6%9C%9F%E5%88%8A%E6%96%87%E7%AB%A0&nav=1&langType=1",
);

const ncpssdPcSecureSnippet = `
  <div class="result-list">
    <a onclick="openDetail('/Literature/secure/articleinfo?params=encrypted-demo')"
       title='超越经济激励：平台经济中的评论激励机制、市场交易行为与社会福利'>
      超越经济激励：平台经济中的评论激励机制、市场交易行为与社会福利
    </a>
    <a onclick="AddHandleCount(this, '中文期刊文章', 'GLSJ2026005008', 1, -1, '/Literature/readurl?id=GLSJ2026005008', '95499X', '[F49]', '超越经济激励：平台经济中的评论激励机制、市场交易行为与社会福利', '罗俊[1];潘佳艺[1];邹乐豪[1]', '管理世界')">
      下载全文&gt;&gt;
    </a>
  </div>
`;

const secureArticles = parseNcpssdIssueArticles(ncpssdPcSecureSnippet, "https://www.ncpssd.cn/journal/details?gch=95499X");

assert.equal(secureArticles.length, 1);
assert.equal(secureArticles[0].id, "GLSJ2026005008");
assert.equal(secureArticles[0].authors, "罗俊; 潘佳艺; 邹乐豪");
assert.equal(secureArticles[0].official_url, "https://www.ncpssd.cn/Literature/secure/articleinfo?params=encrypted-demo");
assert.equal(secureArticles[0].reader_url, "https://www.ncpssd.cn/Literature/readurl?id=GLSJ2026005008");

const cnkiSequentialArticles = resolveCnkiSequentialArticles(
  [
    { title: "科技强国建设中的双重创新动力源——一个知识流创新链分析框架及其考证" },
    { title: "超越经济激励：平台经济中的评论激励机制、市场交易行为与社会福利" },
  ],
  {
    journal_code: "GLSJ",
    access_model: "paid",
    url_template: "https://kns.cnki.net/kcms/detail/detail.aspx?dbcode=CJFD&filename={filename}",
  },
  { year: "2026", issue: "5" },
);

assert.equal(cnkiSequentialArticles[0].cnki_filename, "GLSJ202605001");
assert.equal(cnkiSequentialArticles[0].official_source, "cnki");
assert.equal(cnkiSequentialArticles[0].access_model, "paid");
assert.equal(
  cnkiSequentialArticles[1].official_url,
  "https://kns.cnki.net/kcms/detail/detail.aspx?dbcode=CJFD&filename=GLSJ202605002",
);

console.log("official link resolver rules ok");
