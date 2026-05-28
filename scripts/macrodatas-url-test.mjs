import assert from "node:assert/strict";

import { macrodatasArticleSectionUrl } from "./macrodatas-url.mjs";

assert.equal(
  macrodatasArticleSectionUrl(
    "https://www.macrodatas.cn/article/1779681420#directory-01",
    "科技强国建设中的双重创新动力源——一个知识流创新链分析框架及其考证",
  ),
  "https://www.macrodatas.cn/article/1779681420#:~:text=%E7%A7%91%E6%8A%80%E5%BC%BA%E5%9B%BD%E5%BB%BA%E8%AE%BE%E4%B8%AD%E7%9A%84%E5%8F%8C%E9%87%8D%E5%88%9B%E6%96%B0%E5%8A%A8%E5%8A%9B%E6%BA%90%E2%80%94%E2%80%94%E4%B8%80%E4%B8%AA%E7%9F%A5%E8%AF%86%E6%B5%81%E5%88%9B%E6%96%B0%E9%93%BE%E5%88%86%E6%9E%90%E6%A1%86%E6%9E%B6%E5%8F%8A%E5%85%B6%E8%80%83%E8%AF%81",
);

console.log("macrodatas url rules ok");
