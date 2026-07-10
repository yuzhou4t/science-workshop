import assert from "node:assert/strict";

import { issueLinksFromArticles } from "./backfill-macrodatas-abstracts.mjs";

const links = issueLinksFromArticles([
  {
    issue_date: "2026-06",
    discovery_url: "https://www.macrodatas.cn/article/1782099180#:~:text=论文一",
  },
  {
    issue_date: "2026-06",
    discovery_url: "https://www.macrodatas.cn/article/1782099180#:~:text=论文二",
  },
  {
    issue_date: "2026-04",
    discovery_url: "https://example.com/article/ignored",
  },
]);

assert.deepEqual(links, [
  {
    url: "https://www.macrodatas.cn/article/1782099180",
    issue_date: "2026-06",
    title: "已知期次页",
  },
]);

console.log("Macrodatas known issue links ok");
