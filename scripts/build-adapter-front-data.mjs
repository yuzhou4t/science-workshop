import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

export function buildAdapterFrontData(registry) {
  const platformById = new Map((registry.platform_profiles || []).map((profile) => [profile.id, profile]));
  const adapterQueue = (registry.adapter_queue || []).map((item) => {
    const profile = platformById.get(item.platform_id) || {};
    return {
      journal_id: item.journal_id,
      journal_name: item.journal_name,
      platform_id: item.platform_id,
      platform_name: profile.name || item.platform_id,
      strategy: profile.strategy || "",
      fields: profile.fields || [],
      status: item.status || "规则待确认",
      source_url: item.source_url || "",
      adapter_kind: item.adapter_rule?.kind || "",
      next_action: profile.next_action || "",
      render_required: Boolean(profile.render_required),
    };
  });

  const platformProfiles = (registry.platform_profiles || []).map((profile) => ({
    id: profile.id,
    name: profile.name,
    strategy: profile.strategy,
    render_required: Boolean(profile.render_required),
    fields: profile.fields || [],
    next_action: profile.next_action || "",
    journals: adapterQueue.filter((item) => item.platform_id === profile.id).map((item) => item.journal_id),
  }));

  const directFeeds = (registry.direct_article_feeds || []).map((feed) => ({
    journal_id: feed.journal_id,
    journal_name: feed.journal_name,
    feed_url: feed.feed_url,
    parser_profile: feed.parser_profile,
  }));

  return {
    version: registry.version || "",
    updated_at: registry.updated_at || "",
    summary: {
      direct_article_feeds: directFeeds.length,
      adapter_sources: adapterQueue.length,
      platform_profiles: platformProfiles.length,
      ready_rules: adapterQueue.filter((item) => item.adapter_kind && !/待/.test(item.status)).length,
      fallback_rules: adapterQueue.filter((item) => /替代|兜底|维普|开放元数据|DOI/.test(item.status)).length,
    },
    direct_article_feeds: directFeeds,
    platform_profiles: platformProfiles,
    adapter_queue: adapterQueue,
  };
}

async function main() {
  const registryPath = new URL("../data/adapter-profiles.json", import.meta.url);
  const outputPath = new URL("../data/adapter-front-data.js", import.meta.url);
  const registry = JSON.parse(await readFile(registryPath, "utf8"));
  const frontData = buildAdapterFrontData(registry);
  const js = `window.ADAPTER_PROFILE_DATA = ${JSON.stringify(frontData, null, 2)};\n`;
  await writeFile(outputPath, js, "utf8");
  console.log(`wrote ${outputPath.pathname}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}
