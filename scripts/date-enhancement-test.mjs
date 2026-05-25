import assert from "node:assert/strict";

import { extractDateHints } from "./date-enhancement-lib.mjs";

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

console.log("date enhancement rules ok");
