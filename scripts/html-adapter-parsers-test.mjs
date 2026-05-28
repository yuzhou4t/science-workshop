import assert from "node:assert/strict";

import {
  parseAscIssueListArticles,
  parseCieCurrentArticles,
  parseJmscReaderIssueArticles,
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

const jmscArticles = parseJmscReaderIssueArticles(`
  <div>
    20260401
    <a href="view_abstract.aspx?file_no=20260401&flag=1">异质性环境规制、绿色创新与企业绿色形象的关系研究</a>
    解学梅，陈文妍，倪书阳，郭海望 2026,(4):1-16
  </div>
  <div>
    20260402
    <a href="/ch/reader/view_abstract.aspx?file_no=20260402&flag=1">区域一体化推进的工业污染集聚效应——来自长三角边界效应与扩容影响的证据</a>
    邵帅，徐乐，范美婷 2026,(4):17-39
  </div>
`, "https://jmsc.tju.edu.cn/ch/reader/issue_query.aspx");

assert.deepEqual(jmscArticles, [
  {
    title: "异质性环境规制、绿色创新与企业绿色形象的关系研究",
    url: "https://jmsc.tju.edu.cn/ch/reader/view_abstract.aspx?file_no=20260401&flag=1",
    authors: "解学梅, 陈文妍, 倪书阳, 郭海望",
    author_source: "reader_issue",
    issue_date: "2026-04",
    date_source: "reader_issue",
  },
  {
    title: "区域一体化推进的工业污染集聚效应——来自长三角边界效应与扩容影响的证据",
    url: "https://jmsc.tju.edu.cn/ch/reader/view_abstract.aspx?file_no=20260402&flag=1",
    authors: "邵帅, 徐乐, 范美婷",
    author_source: "reader_issue",
    issue_date: "2026-04",
    date_source: "reader_issue",
  },
]);

console.log("html adapter parser rules ok");
