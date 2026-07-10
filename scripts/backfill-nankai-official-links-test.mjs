import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  historicalIssueDatesForArticle,
  issueDatesForArticle,
  parseNbrAnchors,
} from "./backfill-nankai-official-links.mjs";

assert.deepEqual(issueDatesForArticle({ issue_date: "2026-06", first_seen_at: "2026-06-23" }), ["2026-06"]);
assert.deepEqual(
  historicalIssueDatesForArticle({ issue_date: "2026-06", first_seen_at: "2026-06-23" }),
  [
    "2026-01", "2026-02", "2026-03", "2026-04", "2026-05",
    "2025-01", "2025-02", "2025-03", "2025-04", "2025-05", "2025-06",
  ],
);
assert.equal(issueDatesForArticle({ issue_date: "", first_seen_at: "2026-05-29" }).length, 12);
assert.equal(issueDatesForArticle({ issue_date: "", first_seen_at: "" }).length, 0);

const html = `
  <a href="/article/1" title="候选论文">候选论文</a>
  <a href="https://example.com/article/2" title="不能接受">不能接受</a>
  <a href="/article/3">另一个标题</a>
`;
const candidates = parseNbrAnchors(html, "https://nbr.nankai.edu.cn/archive");
assert.equal(candidates.length, 2);
assert.equal(candidates[0].official_url, "https://nbr.nankai.edu.cn/article/1");
assert.equal(candidates[1].title.trim(), "另一个标题");

const source = await readFile(new URL("./backfill-nankai-official-links.mjs", import.meta.url), "utf8");
assert.match(source, /status === 412/, "Nankai access protection should include HTTP 412");
assert.match(source, /patched\.link_note/, "link evidence should preserve exact versus unique fuzzy title matching");
assert.match(source, /ncpssd_historical_scan/, "known issue misses should fall back to nearby formal issues");

console.log("Nankai historical official-link rules ok");
