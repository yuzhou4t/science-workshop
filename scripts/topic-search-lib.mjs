function asArray(value) {
  if (Array.isArray(value)) return value.filter(Boolean);
  if (value) return [value];
  return [];
}

function normalizeText(value = "") {
  return String(value || "").toLocaleLowerCase("zh-Hans-CN");
}

function includesTerm(value, term) {
  return normalizeText(value).includes(normalizeText(term));
}

function articleFields(article = {}) {
  return [
    ["title", article.title || ""],
    ["keywords", asArray(article.keywords).join(" ")],
    ["abstract", article.abstract || ""],
    ["authors", article.authors || ""],
    ["journal", [article.journal_name, article.journal, article.subject].filter(Boolean).join(" ")],
  ];
}

function firstKeywordMatch(fields, keywords = []) {
  for (const [field, value] of fields) {
    for (const keyword of keywords) {
      if (keyword && includesTerm(value, keyword)) {
        return { field, keyword };
      }
    }
  }
  return null;
}

function disciplineMatches(article, disciplines = []) {
  const fields = articleFields(article);
  const subjectFields = [
    ["journal", [article.subject, article.journal_name, article.journal].filter(Boolean).join(" ")],
  ];
  return disciplines
    .map((discipline) => {
      const subjectMatch = firstKeywordMatch(subjectFields, discipline.subject_keywords || []);
      const keywordMatch = firstKeywordMatch(fields, discipline.keywords || []);
      const match = subjectMatch || keywordMatch;
      if (!match) return null;
      const score = subjectMatch ? 3 : match.field === "title" || match.field === "keywords" ? 2 : 1;
      return {
        id: discipline.id,
        label: discipline.label,
        match_field: match.field,
        match_keyword: match.keyword,
        score,
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score || a.label.localeCompare(b.label, "zh-Hans-CN"));
}

function semanticResultFor(article, semanticCache = {}, topicId) {
  const cached = semanticCache[article.id] || semanticCache[String(article.id || "")];
  if (!cached || cached.topic_id !== topicId || cached.relevant !== true) return null;
  return cached;
}

function resultFromArticle(article, topic, match, disciplines, options = {}) {
  const matchMode = options.matchMode || "rule";
  const reason = matchMode === "semantic"
    ? options.reason || "语义判断补充命中"
    : `${match.field} 命中 “${match.keyword}”`;
  return {
    article_id: article.id,
    topic_id: topic.id,
    topic_label: topic.label,
    title: article.title || "",
    journal_id: article.journal_id || "",
    source_journal_id: article.source_journal_id || article.journal_id || "",
    journal_name: article.journal_name || "",
    authors: article.authors || "",
    url: article.url || "",
    official_url: article.official_url || "",
    pdf_url: article.pdf_url || "",
    discovery_url: article.discovery_url || "",
    link_status: article.link_status || "",
    published_at: article.published_at || "",
    issue_date: article.issue_date || "",
    first_seen_at: article.first_seen_at || "",
    display_date: article.display_date || article.published_at || article.issue_date || article.first_seen_at || "",
    abstract: article.abstract || "",
    keywords: asArray(article.keywords),
    match_mode: matchMode,
    match_field: match.field || "",
    match_keyword: match.keyword || "",
    match_reason: reason,
    confidence: options.confidence ?? (matchMode === "semantic" ? 0.68 : 1),
    disciplines,
  };
}

export function buildTopicSearchIndex({ articles = [], tagConfig = {}, semanticCache = {}, useSemantic = false, semanticEnabled = false } = {}) {
  const topics = tagConfig.topics || [];
  const disciplines = tagConfig.disciplines || [];
  const results = [];

  for (const article of articles) {
    const fields = articleFields(article);
    for (const topic of topics) {
      const ruleMatch = firstKeywordMatch(fields, topic.keywords || []);
      const articleDisciplines = disciplineMatches(article, disciplines);
      if (ruleMatch) {
        results.push(resultFromArticle(article, topic, ruleMatch, articleDisciplines));
        continue;
      }
      const semantic = useSemantic && semanticEnabled ? semanticResultFor(article, semanticCache, topic.id) : null;
      if (semantic) {
        const semanticDisciplines = articleDisciplines.length
          ? articleDisciplines
          : asArray(semantic.disciplines)
            .map((id) => disciplines.find((discipline) => discipline.id === id))
            .filter(Boolean)
            .map((discipline) => ({ id: discipline.id, label: discipline.label, match_field: "semantic", match_keyword: "", score: 1 }));
        results.push(resultFromArticle(article, topic, { field: "semantic", keyword: "" }, semanticDisciplines, {
          matchMode: "semantic",
          reason: semantic.reason || "",
          confidence: typeof semantic.confidence === "number" ? semantic.confidence : 0.68,
        }));
      }
    }
  }

  results.sort((a, b) => String(b.display_date).localeCompare(String(a.display_date)) || a.title.localeCompare(b.title, "zh-Hans-CN"));
  return {
    version: 1,
    updated_at: new Date().toISOString(),
    summary: {
      total_articles: articles.length,
      matched_articles: results.length,
      topics: topics.length,
      disciplines: disciplines.length,
      semantic_enabled: Boolean(useSemantic && semanticEnabled),
    },
    topics: topics.map(({ id, label }) => ({ id, label })),
    disciplines: disciplines.map(({ id, label }) => ({ id, label })),
    results,
  };
}
