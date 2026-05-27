import assert from "node:assert/strict";

import {
  parseAscIssueListArticles,
  parseCieCurrentArticles,
} from "./html-adapter-parsers.mjs";

const cieArticles = parseCieCurrentArticles(`
  <table>
    <tr><td>
      <a href="/Magazine/Show?id=122793">贸易政策不确定性、供应链暴露网络与全球违约风险——来自异质性空间自回归模型的新证据</a>
      <span style="margin-left: 20px;">杨子晖，周学伟，戴志颖</span>
    </td></tr>
    <tr><td><span>2026</span><span>年,第</span>4<span>期</span>:5-27<span>页</span></td></tr>
  </table>
`, "https://ciejournal.ajcass.com/");

assert.deepEqual(cieArticles, [
  {
    title: "贸易政策不确定性、供应链暴露网络与全球违约风险——来自异质性空间自回归模型的新证据",
    url: "https://ciejournal.ajcass.com/Magazine/Show?id=122793",
    authors: "杨子晖, 周学伟, 戴志颖",
    author_source: "list_author",
    issue_date: "2026-04",
    date_source: "context_issue",
  },
]);

const ascArticles = parseAscIssueListArticles(`
  <div class="yjqk-01-cemter">
    <div class="yjqk-01-cemter-left">
      <a href='BrowseDetail.aspx?k=0EB713F2&ID=A3ED' target="_blank">劳动力市场势力如何影响分析师盈余预测准确性?———基于证券公...</a>
    </div>
    <div class="yjqk-01-cemter-center"> 高靖宇...</div>
  </div>
  <div class="yjqk-01-cemter">
    <div class="yjqk-01-cemter-left">
      <a href='BrowseDetail.aspx?k=8BF9&ID=A3ED' target="_blank">耐心资本与企业盈余管理：基于失败容忍度的研究</a>
    </div>
    <div class="yjqk-01-cemter-center"> 蒋亚含</div>
  </div>
`, "https://www.asc.net.cn/AccountingResearch/NewestArticleListCS.aspx?issue=4&year=2026", "2026-04");

assert.deepEqual(ascArticles, [
  {
    title: "劳动力市场势力如何影响分析师盈余预测准确性?———基于证券公...",
    url: "https://www.asc.net.cn/AccountingResearch/BrowseDetail.aspx?k=0EB713F2&ID=A3ED",
    authors: "高靖宇 等",
    author_source: "list_author_partial",
    issue_date: "2026-04",
    date_source: "issue_loop",
  },
  {
    title: "耐心资本与企业盈余管理：基于失败容忍度的研究",
    url: "https://www.asc.net.cn/AccountingResearch/BrowseDetail.aspx?k=8BF9&ID=A3ED",
    authors: "蒋亚含",
    author_source: "list_author",
    issue_date: "2026-04",
    date_source: "issue_loop",
  },
]);

console.log("html adapter parser rules ok");
