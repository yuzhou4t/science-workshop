import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const registryPath = new URL("../data/adapter-profiles.json", import.meta.url);
const registry = JSON.parse(await readFile(registryPath, "utf8"));
const queueById = new Map(registry.adapter_queue.map((item) => [item.journal_id, item]));

function ruleFor(journalId) {
  const item = queueById.get(journalId);
  assert.ok(item, `missing adapter queue item ${journalId}`);
  return item.adapter_rule || {};
}

for (const journalId of ["j15", "j18", "j19"]) {
  const rule = ruleFor(journalId);
  assert.equal(rule.kind, "open-metadata-works", `${journalId} should use open metadata fallback`);
  assert.ok(Array.isArray(rule.issns) && rule.issns.length >= 1, `${journalId} should declare ISSNs`);
  assert.ok(Array.isArray(rule.fallback_services) && rule.fallback_services.includes("crossref"), `${journalId} should try Crossref`);
}

assert.equal(ruleFor("j11").kind, "asc-current-issue-html", "会计研究 should use the current ASC issue endpoint");
assert.equal(ruleFor("j10").kind, "cqvip-journal-html", "中国行政管理 should use the CQVIP SSR catalog fallback");
assert.equal(ruleFor("j10").official_resolver?.kind, "ncpssd-issue-html", "中国行政管理 should resolve CQVIP discovery records to NCPSD article details");
assert.equal(ruleFor("j6").official_resolver?.kind, "ncpssd-issue-html", "管理世界 should resolve Macrodatas discovery records to NCPSD article details");
assert.match(ruleFor("j6").official_resolver?.issue_url_template || "", /\{year\}.*\{issue\}/, "管理世界 NCPSD resolver should follow the discovered issue");
assert.ok(ruleFor("j6").official_resolvers?.some((resolver) => resolver.kind === "cnki-cjfd-sequential"), "管理世界 should fall back to paid CNKI article detail pages");
assert.equal(ruleFor("j7").official_resolver?.kind, "ncpssd-issue-html", "南开管理评论 should try NCPSD article details when the discovered issue is listed");
assert.match(ruleFor("j7").official_resolver?.issue_url_template || "", /\{year\}.*\{issue\}/, "南开管理评论 NCPSD resolver should follow the discovered issue");

for (const journalId of ["j6", "j7"]) {
  const rule = ruleFor(journalId);
  assert.equal(rule.kind, "macrodatas-issue-list", `${journalId} should use Macrodatas issue discovery`);
  assert.ok(rule.journal_title, `${journalId} should include the journal title used for result filtering`);
  assert.ok(Array.isArray(rule.search_terms) && rule.search_terms.length >= 1, `${journalId} should include search terms`);
}

console.log("adapter fallback rules ok");
