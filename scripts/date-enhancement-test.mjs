import assert from "node:assert/strict";

import { extractDateHints, extractMetadataDateHints } from "./date-enhancement-lib.mjs";

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
