import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { buildTopicSearchIndex } from "./topic-search-lib.mjs";

const historyPath = new URL("../data/push-history.json", import.meta.url);
const tagConfigPath = new URL("../data/search-tags.json", import.meta.url);
const semanticCachePath = new URL("../data/topic-search-semantic-cache.json", import.meta.url);
const outputPath = new URL("../data/topic-search-index.js", import.meta.url);
const DEFAULT_DEEPSEEK_BASE_URL = "https://api.deepseek.com";
const DEFAULT_DEEPSEEK_MODEL = "deepseek-chat";
const TOPIC_SEARCH_INDEX_PREFIX = "window.TOPIC_SEARCH_INDEX = ";

function cliFlag(name) {
  return process.argv.slice(2).includes(name);
}

async function readJsonIfExists(url, fallback) {
  try {
    return JSON.parse(await readFile(url, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return fallback;
    throw error;
  }
}

async function readTopicSearchIndexIfExists(url) {
  try {
    const raw = await readFile(url, "utf8");
    const jsonText = raw
      .trim()
      .replace(/^window\.TOPIC_SEARCH_INDEX\s*=\s*/, "")
      .replace(/;\s*$/, "");
    return JSON.parse(jsonText);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

function comparableTopicSearchIndex(index) {
  if (!index) return null;
  return { ...index, updated_at: "" };
}

export function topicSearchIndexChanged(existingIndex, nextIndex) {
  return JSON.stringify(comparableTopicSearchIndex(existingIndex)) !== JSON.stringify(comparableTopicSearchIndex(nextIndex));
}

function textFingerprint(article = {}) {
  return [
    article.title || "",
    article.abstract || "",
    Array.isArray(article.keywords) ? article.keywords.join("|") : article.keywords || "",
  ].join("\n").slice(0, 4000);
}

function semanticText(article = {}) {
  return [
    `Title: ${article.title || ""}`,
    article.authors ? `Authors: ${article.authors}` : "",
    article.journal_name ? `Journal: ${article.journal_name}` : "",
    article.abstract ? `Abstract: ${article.abstract}` : "",
    Array.isArray(article.keywords) && article.keywords.length ? `Keywords: ${article.keywords.join(", ")}` : "",
  ].filter(Boolean).join("\n");
}

function parseJsonObject(text = "") {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const match = trimmed.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("DeepSeek classifier did not return JSON");
    return JSON.parse(match[0]);
  }
}

async function classifyArticleWithDeepSeek(article, tagConfig) {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  const baseUrl = (process.env.DEEPSEEK_BASE_URL || DEFAULT_DEEPSEEK_BASE_URL).replace(/\/$/, "");
  const model = process.env.DEEPSEEK_MODEL || DEFAULT_DEEPSEEK_MODEL;
  const disciplineIds = (tagConfig.disciplines || []).map((discipline) => discipline.id).join(", ");
  const prompt = [
    "请判断下面这篇期刊文章是否与非洲研究相关。",
    "只输出 JSON，不要输出解释性 Markdown。",
    `discipline_ids 可选值: ${disciplineIds}`,
    "JSON 格式: {\"relevant\": true|false, \"confidence\": 0-1, \"reason\": \"一句中文依据\", \"disciplines\": [\"discipline_id\"]}",
    "",
    semanticText(article),
  ].join("\n");
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: "你是严谨的学术文献主题分类助手，只输出 JSON。" },
        { role: "user", content: prompt },
      ],
      temperature: 0,
    }),
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`DeepSeek classifier failed: HTTP ${response.status} ${detail.slice(0, 200)}`);
  }
  const data = await response.json();
  const content = data?.choices?.[0]?.message?.content;
  if (!content) throw new Error("DeepSeek classifier response missing content");
  const parsed = parseJsonObject(content);
  return {
    topic_id: "africa",
    relevant: parsed.relevant === true,
    confidence: typeof parsed.confidence === "number" ? parsed.confidence : 0.5,
    reason: String(parsed.reason || "").slice(0, 160),
    disciplines: Array.isArray(parsed.disciplines) ? parsed.disciplines : [],
    fingerprint: textFingerprint(article),
  };
}

async function enrichSemanticCache({ articles, tagConfig, semanticCache, ruleIndex }) {
  const ruleMatched = new Set(ruleIndex.results.map((result) => `${result.topic_id}:${result.article_id}`));
  let changed = false;
  for (const article of articles) {
    if (!article?.id || ruleMatched.has(`africa:${article.id}`)) continue;
    if (!article.abstract && !(Array.isArray(article.keywords) && article.keywords.length)) continue;
    const cached = semanticCache[article.id];
    const fingerprint = textFingerprint(article);
    if (cached?.fingerprint === fingerprint) continue;
    semanticCache[article.id] = await classifyArticleWithDeepSeek(article, tagConfig);
    changed = true;
  }
  return changed;
}

async function main() {
  const history = await readJsonIfExists(historyPath, { articles: [] });
  const tagConfig = await readJsonIfExists(tagConfigPath, { topics: [], disciplines: [] });
  const semanticCache = await readJsonIfExists(semanticCachePath, {});
  const useSemantic = cliFlag("--semantic");
  const semanticEnabled = Boolean(process.env.DEEPSEEK_API_KEY);
  const ruleIndex = buildTopicSearchIndex({
    articles: history.articles || [],
    tagConfig,
    semanticCache,
    useSemantic: false,
    semanticEnabled: false,
  });

  if (useSemantic && semanticEnabled) {
    const changed = await enrichSemanticCache({
      articles: history.articles || [],
      tagConfig,
      semanticCache,
      ruleIndex,
    });
    if (changed) {
      await writeFile(semanticCachePath, `${JSON.stringify(semanticCache, null, 2)}\n`, "utf8");
    }
  }

  const index = buildTopicSearchIndex({
    articles: history.articles || [],
    tagConfig,
    semanticCache,
    useSemantic,
    semanticEnabled,
  });

  const existingIndex = await readTopicSearchIndexIfExists(outputPath);
  if (!topicSearchIndexChanged(existingIndex, index)) {
    console.log(`topic search index unchanged (${index.summary.matched_articles} matched / ${index.summary.total_articles} articles)`);
    if (useSemantic && !semanticEnabled) {
      console.log("semantic classification skipped: DEEPSEEK_API_KEY is not set");
    }
    return;
  }

  await writeFile(outputPath, `${TOPIC_SEARCH_INDEX_PREFIX}${JSON.stringify(index, null, 2)};\n`, "utf8");
  console.log(`wrote ${outputPath.pathname} (${index.summary.matched_articles} matched / ${index.summary.total_articles} articles)`);
  if (useSemantic && !semanticEnabled) {
    console.log("semantic classification skipped: DEEPSEEK_API_KEY is not set");
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}
