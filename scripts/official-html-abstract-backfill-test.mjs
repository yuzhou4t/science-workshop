import assert from "node:assert/strict";

import { extractStrictOfficialHtmlAbstract } from "./backfill-official-html-abstracts.mjs";

const html = `
  <html><head>
    <meta name="citation_title" content="全球金融周期、宏观审慎政策和跨境资本流动——兼论‘三元悖论’和‘二元悖论’之争">
    <meta name="citation_abstract" content="这是一段来自期刊官方文章页的完整摘要，用于验证严格标题匹配后才允许回填，长度也足以排除导航说明。">
    <meta name="citation_keywords" content="全球金融周期;宏观审慎政策;跨境资本流动">
  </head></html>
`;

const matched = extractStrictOfficialHtmlAbstract({
  title: "全球金融周期、宏观审慎政策和跨境资本流动——兼论“三元悖论”和“二元悖论”之争",
  url: "https://www.jryj.org.cn/CN/abstract/abstract1332.shtml",
}, html);
assert.equal(matched.abstract.startsWith("这是一段来自期刊官方文章页"), true);
assert.deepEqual(matched.keywords, ["全球金融周期", "宏观审慎政策", "跨境资本流动"]);

assert.equal(extractStrictOfficialHtmlAbstract({
  title: "另一篇完全不同的文章",
  url: "https://www.jryj.org.cn/CN/abstract/abstract1332.shtml",
}, html), null);

console.log("Official HTML abstract backfill rules ok");
