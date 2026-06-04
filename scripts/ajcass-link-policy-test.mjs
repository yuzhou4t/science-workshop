import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const frontDataText = await readFile(new URL("../data/recent-front-data.js", import.meta.url), "utf8");
const context = { window: {} };
vm.runInNewContext(frontDataText, context);

const articles = context.window.RECENT_WORKFLOW_DATA.push_queue || [];
const ajcassArticles = articles.filter((article) => ["经济研究", "中国农村经济"].includes(article.journal_name));
const issueDetailArticles = ajcassArticles.filter((article) => String(article.url || "").includes("/#/issueDetail"));

assert.equal(issueDetailArticles.length, 0, "AJCASS issueDetail routes must not be used as frontend article links");

for (const article of ajcassArticles) {
  assert.equal(article.link_status, "official_pdf");
  assert.match(article.url, /\.pdf(?:$|[?#])/i);
  assert.match(article.pdf_url, /\.pdf(?:$|[?#])/i);
  assert.match(article.discovery_url, /\/#\/issueDetail\?id=\d+/);
}

console.log("ajcass link policy rules ok");
