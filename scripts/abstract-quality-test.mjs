import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const history = JSON.parse(await readFile(new URL("../data/push-history.json", import.meta.url), "utf8"));
const byTitle = new Map((history.articles || []).map((article) => [article.title, article]));

const checks = [
  {
    title: "马克思产业演进理论视角下地方政府推动特色产业演进的适应性治理机制",
    forbidden: /螺响粉/,
  },
  {
    title: "年末“突击花钱”与惠农工程闲置：现实影响、底层动因与治理路径",
    forbidden: /年未|串农|预防性储著|震基预算|过制/,
  },
  {
    title: "Booms, Busts, and Mismatch in Capital Markets: Evidence from the Offshore Oil and Gas Industry",
    forbidden: /\bemail\s*:|\bi thank\b|\bwe thank\b|\backnowledg|\bseminar participants\b/i,
  },
  {
    title: "Private Private Information",
    forbidden: /full paper is available/i,
  },
  {
    title: "US Public Debt and Safe Asset Market Power",
    forbidden: /\bi thank\b|\bwe thank\b|\backnowledg|previous draft|seminar participants/i,
  },
];

for (const check of checks) {
  const article = byTitle.get(check.title);
  assert.ok(article, `missing article: ${check.title}`);
  assert.ok(article.abstract, `missing verified abstract: ${check.title}`);
  assert.doesNotMatch(article.abstract, check.forbidden, `abstract contains non-abstract or OCR-noise text: ${check.title}`);
}

console.log("abstract quality rules ok");
