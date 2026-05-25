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

for (const journalId of ["j6", "j7"]) {
  const rule = ruleFor(journalId);
  assert.equal(rule.kind, "macrodatas-issue-list", `${journalId} should use Macrodatas issue discovery`);
  assert.ok(rule.journal_title, `${journalId} should include the journal title used for result filtering`);
  assert.ok(Array.isArray(rule.search_terms) && rule.search_terms.length >= 1, `${journalId} should include search terms`);
}

console.log("adapter fallback rules ok");
