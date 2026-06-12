import assert from "node:assert/strict";

import {
  extractDateHints,
  extractHtmlArticleHints,
  extractMetadataArticleHints,
  extractMetadataDateHints,
} from "./date-enhancement-lib.mjs";

assert.deepEqual(extractDateHints({
  url: "https://sjjj.magtech.com.cn/CN/Y2026/V49/I5/3",
  context: "",
}), {
  issue_date: "2026-05",
  date_source: "url_issue",
});

assert.deepEqual(extractDateHints({
  url: "https://jmsc.tju.edu.cn/jmsc/article/issue/2026_4",
  context: "",
}), {
  issue_date: "2026-04",
  date_source: "url_issue",
});

assert.deepEqual(extractDateHints({
  url: "https://jmsc.tju.edu.cn/jmsc/article/abstract/20260401?st=article_issue",
  context: "",
}), {
  issue_date: "2026-04",
  date_source: "url_issue",
});

assert.deepEqual(extractDateHints({
  url: "https://ciejournal.ajcass.com/Magazine/Show?id=122800",
  context: "作者 2026年,第4期:194-216页 下载全文",
}), {
  issue_date: "2026-04",
  date_source: "context_issue",
});

assert.deepEqual(extractDateHints({
  url: "https://onlinelibrary.wiley.com/doi/10.1111/jofi.70050",
  context: "Why Have CEO Pay Levels Become Less Diverse? Version of Record online: 5/19/2026 | DOI:10.1111/jofi.70050",
}), {
  published_at: "2026-05-19",
  date_source: "context_published",
});

assert.deepEqual(extractDateHints({
  url: "https://journals.sagepub.com/doi/full/10.1177/00018392251405843",
  context: "June 2026 Table of Contents Articles Unequal in the Spotlight",
}), {
  issue_date: "2026-06",
  date_source: "context_issue",
});

assert.deepEqual(extractDateHints({
  url: "https://journals.sagepub.com/doi/full/10.1177/00018392261431827",
  context: "Open Access Research article First published online April 12, 2026 Volume 71 Issue 2",
}), {
  published_at: "2026-04-12",
  date_source: "context_published",
});

assert.deepEqual(extractMetadataDateHints({
  message: {
    "published-online": { "date-parts": [[2026, 4, 12]] },
    "published-print": { "date-parts": [[2026, 6]] },
  },
}), {
  published_at: "2026-04-12",
  issue_date: "2026-06",
  date_source: "metadata_published",
});

assert.deepEqual(extractMetadataArticleHints({
  message: {
    author: [
      { given: "Simon", family: "Johnson" },
      { given: "Lukasz", family: "Rachel" },
      { given: "Catherine", family: "Wolfram" },
    ],
    "published-online": { "date-parts": [[2026, 5, 23]] },
    abstract: "<jats:p>Abstract This paper studies monetary policy surprises and firm payouts.</jats:p>",
  },
}), {
  authors: "Simon Johnson, Lukasz Rachel, Catherine Wolfram",
  author_source: "metadata_author",
  published_at: "2026-05-23",
  date_source: "metadata_published",
  abstract: "This paper studies monetary policy surprises and firm payouts.",
});

assert.deepEqual(extractMetadataArticleHints({
  display_name: "Team Hierarchical Adaptability",
  abstract_inverted_index: {
    We: [0],
    introduce: [1],
    hierarchical: [3],
    adaptability: [4],
    concept: [2],
  },
}), {
  abstract: "We introduce concept hierarchical adaptability",
});

assert.deepEqual(extractHtmlArticleHints({
  url: "https://www.aeaweb.org/articles?id=10.1257/aer.20250064",
  context: `
    <meta name="citation_author" content="Johnson, Simon">
    <meta name="citation_author" content="Rachel, Lukasz">
    <meta name="citation_author" content="Wolfram, Catherine">
    <ul class="attribution">
      <li class="author">Simon Johnson</li>
      <li class="author">Lukasz Rachel</li>
    </ul>
  `,
}), {
  authors: "Simon Johnson, Lukasz Rachel, Catherine Wolfram",
  author_source: "meta_author",
});

assert.deepEqual(extractHtmlArticleHints({
  url: "https://www.aeaweb.org/journals/aer/forthcoming",
  context: `
    <div class="article-item-authors">
      <span class="fn n"><span class="given-name">Simon</span> <span class="family-name">Johnson</span></span>
      <span class="fn n"><span class="given-name">Lukasz</span> <span class="family-name">Rachel</span></span>
      <span class="fn n"><span class="given-name">Catherine</span> <span class="family-name">Wolfram</span></span>
    </div>
  `,
}), {
  authors: "Simon Johnson, Lukasz Rachel, Catherine Wolfram",
  author_source: "html_author",
  date_source: "forthcoming_unassigned",
});

assert.deepEqual(extractHtmlArticleHints({
  url: "https://sjjj.magtech.com.cn/CN/Y2026/V49/I5/3",
  context: '<meta name="authors" content="史青, 孟恩恩, 陈梦婷"><meta name="citation_online_date" content="2026/05/10">',
}), {
  authors: "史青, 孟恩恩, 陈梦婷",
  author_source: "meta_author",
  published_at: "2026-05-10",
  date_source: "meta_published",
});

assert.deepEqual(extractHtmlArticleHints({
  url: "https://sjjj.magtech.com.cn/CN/Y2026/V49/I5/172",
  context: '<meta name="authors" content="蒋旸阳 孙早"><meta name="citation_online_date" content="2026/05/10">',
}), {
  authors: "蒋旸阳, 孙早",
  author_source: "meta_author",
  published_at: "2026-05-10",
  date_source: "meta_published",
});

assert.deepEqual(extractHtmlArticleHints({
  url: "https://sjjj.magtech.com.cn/CN/Y2026/V49/I5/172",
  context: '<meta name="authors" content="孙早, 蒋旸阳"><meta name="citation_issue" content="5"><meta name="citation_publication_date" content="2026/05/10"><meta name="citation_online_date" content="2026/05/10"><script>window.metaData={"shouCiFaBuRiQi":"2026-05-18"}</script>',
}), {
  authors: "孙早, 蒋旸阳",
  author_source: "meta_author",
  published_at: "2026-05-18",
  issue_date: "2026-05",
  date_source: "context_published",
});

assert.deepEqual(extractHtmlArticleHints({
  url: "http://www.jryj.org.cn/CN/abstract/abstract1599.shtml",
  context: '<meta name="DC.Contributor" content="舒少文" /><meta name="DC.Contributor" content=" 蔡庆丰" /><meta name="DC.Contributor" content=" 陈栋" /><meta name="DC.Contributor" content=" 邹静娴" />',
}), {
  authors: "舒少文, 蔡庆丰, 陈栋, 邹静娴",
  author_source: "meta_author",
});

assert.deepEqual(extractHtmlArticleHints({
  url: "https://jmsc.tju.edu.cn/jmsc/article/abstract/20260401",
  context: '<meta name="citation_authors" xml:lang="cn" content="解学梅，陈文妍，倪书阳，郭海望"/><meta name="citation_authors" xml:lang="en" content="XIE Xue-mei, CHEN Wen-yan, NI Shu-yang, GUO Hai-wang"/>',
}), {
  authors: "解学梅, 陈文妍, 倪书阳, 郭海望",
  author_source: "meta_author",
  issue_date: "2026-04",
  date_source: "url_issue",
});

assert.deepEqual(extractHtmlArticleHints({
  url: "https://jmsc.tju.edu.cn/jmsc/article/abstract/20260401",
  context: '<meta name="citation_abstract" content="本文研究环境规制、绿色创新与企业绿色形象之间的关系。"><meta name="citation_keywords" content="环境规制;绿色创新;企业绿色形象">',
}), {
  abstract: "本文研究环境规制、绿色创新与企业绿色形象之间的关系。",
  keywords: ["环境规制", "绿色创新", "企业绿色形象"],
  issue_date: "2026-04",
  date_source: "url_issue",
});

assert.deepEqual(extractHtmlArticleHints({
  url: "http://www.jryj.org.cn/CN/abstract/abstract1599.shtml",
  context: `
    <div>
      摘要：本文基于上市公司样本研究金融科技对企业融资约束的影响，并进一步检验作用机制。
      关键词：金融科技 融资约束 企业投资
    </div>
  `,
}), {
  abstract: "本文基于上市公司样本研究金融科技对企业融资约束的影响，并进一步检验作用机制。",
  keywords: ["金融科技", "融资约束", "企业投资"],
});

assert.deepEqual(extractHtmlArticleHints({
  url: "http://www.jryj.org.cn/CN/abstract/abstract1607.shtml",
  context: `
    摘要 参考文献 补充材料 相关文章 推荐阅读 下载: PDF 输出: BibTeX | EndNote (RIS)
    摘要 提振消费须从需求和供给两端协同发力,以惠民生激发消费意愿,以发展民营经济优化消费供给,并兼顾其长短期效应。
    本文构建了带有纵向产业结构的多部门DSGE模型,分析财政支出结构调整对消费的提振作用。
    服务 把本文推荐给朋友 加入我的书架
    关键词: 提振消费 民营经济 财政支出结构调整 结构性货币政策
  `,
}), {
  abstract: "提振消费须从需求和供给两端协同发力,以惠民生激发消费意愿,以发展民营经济优化消费供给,并兼顾其长短期效应。 本文构建了带有纵向产业结构的多部门DSGE模型,分析财政支出结构调整对消费的提振作用。",
  keywords: ["提振消费", "民营经济", "财政支出结构调整", "结构性货币政策"],
});

assert.deepEqual(extractHtmlArticleHints({
  url: "https://gggl.cbpt.cnki.net/portal/journal/portal/client/paper/demo",
  context: `
    摘要：乡村振兴战略的实施面临着治理刚性与发展韧性的内在张力。
    关键词：制度张力 治理刚性 发展韧性 制度创新 乡村振兴
    Abstract：The implementation of the Rural Revitalization Strategy faces an inherent tension.
    KeyWords：Institutional Tension Governance Rigidity
  `,
}), {
  abstract: "乡村振兴战略的实施面临着治理刚性与发展韧性的内在张力。",
  keywords: ["制度张力", "治理刚性", "发展韧性", "制度创新", "乡村振兴"],
});

assert.deepEqual(extractHtmlArticleHints({
  url: "https://www.aeaweb.org/articles?id=10.1257/aer.demo",
  context: `
    Abstract: Lack of market transparency can impair liquidity provision.
    Keywords: Liquidity; fragility; order flow transparency.
    Downloads Preview (AEA members only) Journals American Economic Review
  `,
}), {
  abstract: "Lack of market transparency can impair liquidity provision.",
  keywords: ["Liquidity", "fragility", "order flow transparency."],
});

assert.deepEqual(extractHtmlArticleHints({
  url: "https://www.ncpssd.org/Literature/articleinfo?id=ZGXZGL2026003003&type=journalArticle&typename=%E4%B8%AD%E6%96%87%E6%9C%9F%E5%88%8A%E6%96%87%E7%AB%A0&nav=1&langType=1",
  context: `
    <script src="/js/web/Literature/articleinfo.js"></script>
    <input type="hidden" id="ftl_urlId" value="ZGXZGL2026003003">
    <option value="IKRK">摘要</option>
    ISSN 基金资助 时间限定 出版年份： 发布时间： 至 资源类型 核心期刊
  `,
}), {});

assert.deepEqual(extractDateHints({
  url: "http://www.jryj.org.cn/CN/abstract/abstract1599.shtml",
  context: '<meta name="citation_online_date" content="2026-04-24" /><meta name="citation_volume" content="550" /><meta name="citation_issue" content="4" />',
}), {
  published_at: "2026-04-24",
  issue_date: "2026-04",
  date_source: "meta_published",
});

assert.deepEqual(extractDateHints({
  url: "https://gggl.cbpt.cnki.net/portal/journal/portal/client/paper/466fea9b60d22ef094ec2459206a81f3",
  context: '<meta name="citation_publication_date" content="2017-01-20"><meta name="citation_volume" content="v.14"><meta name="citation_issue" content="01">',
}), {
  published_at: "2017-01-20",
  issue_date: "2017-01",
  date_source: "meta_published",
});

assert.deepEqual(extractDateHints({
  url: "https://www.aeaweb.org/articles?id=10.1257%2Faer.20250064",
  context: "<div>American Economic Review (Forthcoming)</div>",
}), {
  date_source: "forthcoming_unassigned",
});

console.log("date enhancement rules ok");
