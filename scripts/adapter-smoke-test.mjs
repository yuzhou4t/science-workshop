import { readFile } from "node:fs/promises";

const registryPath = new URL("../data/adapter-profiles.json", import.meta.url);
const registry = JSON.parse(await readFile(registryPath, "utf8"));

const profileIds = new Set(registry.platform_profiles.map((profile) => profile.id));
const directIds = new Set(registry.direct_article_feeds.map((feed) => feed.journal_id));
const queueIds = new Set();
const errors = [];

for (const profile of registry.platform_profiles) {
  if (!profile.id || !profile.name) errors.push(`profile missing id/name: ${JSON.stringify(profile)}`);
  if (!Array.isArray(profile.fields) || profile.fields.length < 3) errors.push(`profile ${profile.id} needs extraction fields`);
  if (typeof profile.render_required !== "boolean") errors.push(`profile ${profile.id} needs render_required boolean`);
}

for (const item of registry.adapter_queue) {
  if (!item.journal_id || !item.journal_name) errors.push(`queue item missing journal id/name: ${JSON.stringify(item)}`);
  if (!profileIds.has(item.platform_id)) errors.push(`queue item ${item.journal_id} references unknown platform ${item.platform_id}`);
  if (!/^https?:\/\//i.test(item.source_url)) errors.push(`queue item ${item.journal_id} has invalid source_url`);
  if (directIds.has(item.journal_id)) errors.push(`queue item ${item.journal_id} is already marked direct RSS`);
  if (queueIds.has(item.journal_id)) errors.push(`duplicate queue journal ${item.journal_id}`);
  queueIds.add(item.journal_id);
}

for (const feed of registry.direct_article_feeds) {
  if (!/^https?:\/\//i.test(feed.feed_url)) errors.push(`direct feed ${feed.journal_id} has invalid feed_url`);
  if (!feed.parser_profile) errors.push(`direct feed ${feed.journal_id} needs parser_profile`);
}

const platformCounts = registry.adapter_queue.reduce((acc, item) => {
  acc[item.platform_id] = (acc[item.platform_id] || 0) + 1;
  return acc;
}, {});

if (errors.length) {
  console.error(errors.join("\n"));
  process.exit(1);
}

console.log(JSON.stringify({
  version: registry.version,
  direct_article_feeds: registry.direct_article_feeds.length,
  adapter_queue: registry.adapter_queue.length,
  platform_profiles: registry.platform_profiles.length,
  platform_counts: platformCounts
}, null, 2));
