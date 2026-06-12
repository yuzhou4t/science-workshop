import assert from "node:assert/strict";

import {
  parseAscIssueListArticles,
  parseCieCurrentArticles,
  parseJmscReaderIssueArticles,
  parseMacrodatasIssuePageArticles,
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
  <table>
    <tr>
      <td style="width:70px;">20260401</td><td>
        <a href="view_abstract.aspx?flag=1&file_no=20260401&journal_id=jmsc" target='_blank'>异质性环境规制、绿色创新与企业绿色形象的关系研究</a>
      </td>
      <td>解学梅，陈文妍，倪书阳，郭海望</td>
      <td>2026,(4):1-16</td>
    </tr>
    <tr>
      <td style="width:70px;">20260402</td><td>
        <a href="/ch/reader/view_abstract.aspx?flag=1&file_no=20260402&journal_id=jmsc" target='_blank'>区域一体化推进的工业污染集聚效应——来自长三角边界效应与扩容影响的证据</a>
      </td>
      <td>邵帅，徐乐，范美婷</td>
      <td>2026,(4):17-39</td>
    </tr>
  </table>
`, "https://jmsc.tju.edu.cn/ch/reader/issue_query.aspx");

assert.deepEqual(jmscArticles, [
  {
    title: "异质性环境规制、绿色创新与企业绿色形象的关系研究",
    url: "https://jmsc.tju.edu.cn/ch/reader/view_abstract.aspx?flag=1&file_no=20260401&journal_id=jmsc",
    authors: "解学梅, 陈文妍, 倪书阳, 郭海望",
    author_source: "reader_issue",
    issue_date: "2026-04",
    date_source: "reader_issue",
  },
  {
    title: "区域一体化推进的工业污染集聚效应——来自长三角边界效应与扩容影响的证据",
    url: "https://jmsc.tju.edu.cn/ch/reader/view_abstract.aspx?flag=1&file_no=20260402&journal_id=jmsc",
    authors: "邵帅, 徐乐, 范美婷",
    author_source: "reader_issue",
    issue_date: "2026-04",
    date_source: "reader_issue",
  },
]);

const macrodatasArticles = parseMacrodatasIssuePageArticles(`
  <p>01 科技强国建设中的双重创新动力源——一个知识流创新链分析框架及其考证</p>
  <p style="color:#666">易先忠，潘锐，张亚斌</p>
  <p>02 构建中国公共管理自主知识体系的系统性思维和建构性路径</p>
  <p style="color:#666">薛澜，赵静</p>
  <h2># 01 #</h2>
  <p>题目：</p>
  <p>科技强国建设中的双重创新动力源——一个知识流创新链分析框架及其考证 作者：</p>
  <p>易先忠（南京审计大学经济学院）</p>
  <p>摘要：</p>
  <p>创新链“脱节”困境根植于“科学推动—需求拉动”二分认知范式割裂了两大创新动力源的有机联系。</p>
  <p>关键词：</p>
  <p>科技强国 本土需求 科学研究 自主创新 知识流</p>
  <h2># 02 #</h2>
  <p>题目：</p>
  <p>构建中国公共管理自主知识体系的系统性思维和建构性路径 作者：</p>
  <p>薛澜（清华大学公共管理学院）</p>
  <p>摘要：</p>
  <p>中国式现代化、国家治理体系和治理能力紧密相连的公共管理，是中国哲学社会科学自主知识体系构建中不可或缺的重要篇章。</p>
  <p>关键词：</p>
  <p>自主知识体系 公共管理学 系统性思维 建构性路径</p>
`, "https://www.macrodatas.cn/article/1779681420");

assert.deepEqual(macrodatasArticles, [
  {
    title: "科技强国建设中的双重创新动力源——一个知识流创新链分析框架及其考证",
    url: "https://www.macrodatas.cn/article/1779681420#:~:text=%E7%A7%91%E6%8A%80%E5%BC%BA%E5%9B%BD%E5%BB%BA%E8%AE%BE%E4%B8%AD%E7%9A%84%E5%8F%8C%E9%87%8D%E5%88%9B%E6%96%B0%E5%8A%A8%E5%8A%9B%E6%BA%90%E2%80%94%E2%80%94%E4%B8%80%E4%B8%AA%E7%9F%A5%E8%AF%86%E6%B5%81%E5%88%9B%E6%96%B0%E9%93%BE%E5%88%86%E6%9E%90%E6%A1%86%E6%9E%B6%E5%8F%8A%E5%85%B6%E8%80%83%E8%AF%81",
    date: "",
    authors: "易先忠，潘锐，张亚斌",
    abstract: "创新链“脱节”困境根植于“科学推动—需求拉动”二分认知范式割裂了两大创新动力源的有机联系。",
    keywords: ["科技强国", "本土需求", "科学研究", "自主创新", "知识流"],
  },
  {
    title: "构建中国公共管理自主知识体系的系统性思维和建构性路径",
    url: "https://www.macrodatas.cn/article/1779681420#:~:text=%E6%9E%84%E5%BB%BA%E4%B8%AD%E5%9B%BD%E5%85%AC%E5%85%B1%E7%AE%A1%E7%90%86%E8%87%AA%E4%B8%BB%E7%9F%A5%E8%AF%86%E4%BD%93%E7%B3%BB%E7%9A%84%E7%B3%BB%E7%BB%9F%E6%80%A7%E6%80%9D%E7%BB%B4%E5%92%8C%E5%BB%BA%E6%9E%84%E6%80%A7%E8%B7%AF%E5%BE%84",
    date: "",
    authors: "薛澜，赵静",
    abstract: "中国式现代化、国家治理体系和治理能力紧密相连的公共管理，是中国哲学社会科学自主知识体系构建中不可或缺的重要篇章。",
    keywords: ["自主知识体系", "公共管理学", "系统性思维", "建构性路径"],
  },
]);

console.log("html adapter parser rules ok");
