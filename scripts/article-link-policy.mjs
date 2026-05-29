const fallbackDirectoryRules = new Set([
  "macrodatas-issue-list",
  "cqvip-journal-html",
]);

function firstValue(...values) {
  return values.map((value) => String(value || "").trim()).find(Boolean) || "";
}

function isPdfUrl(url = "") {
  try {
    return /\.pdf(?:$|[?#])/i.test(new URL(url).pathname);
  } catch {
    return /\.pdf(?:$|[?#])/i.test(String(url || ""));
  }
}

export function normalizeArticleLink(source = {}, article = source) {
  const extractionRule = firstValue(article.extraction_rule, source.extraction_rule);
  const pdfUrl = firstValue(article.pdf_url);
  const officialUrl = firstValue(article.official_url);
  const rawUrl = firstValue(article.url);
  const rawDiscoveryUrl = firstValue(article.discovery_url);
  const accessModel = firstValue(article.access_model, source.access_model);

  if (pdfUrl) {
    return {
      url: pdfUrl,
      official_url: officialUrl || pdfUrl,
      pdf_url: pdfUrl,
      discovery_url: rawDiscoveryUrl,
      link_status: "official_pdf",
      link_note: "official_pdf_resolved",
    };
  }

  if (officialUrl) {
    const isPaidAccess = accessModel === "paid";
    return {
      url: officialUrl,
      official_url: officialUrl,
      pdf_url: isPdfUrl(officialUrl) ? officialUrl : "",
      discovery_url: rawDiscoveryUrl || (rawUrl && rawUrl !== officialUrl ? rawUrl : ""),
      link_status: isPdfUrl(officialUrl) ? "official_pdf" : isPaidAccess ? "official_paid_detail" : "official_detail",
      link_note: isPdfUrl(officialUrl) ? "official_pdf_resolved" : isPaidAccess ? "official_paid_access" : "official_detail_page",
    };
  }

  if (fallbackDirectoryRules.has(extractionRule)) {
    return {
      url: "",
      official_url: "",
      pdf_url: "",
      discovery_url: rawDiscoveryUrl || rawUrl,
      link_status: "needs_official_pdf",
      link_note: "fallback_directory_requires_official_pdf_resolution",
    };
  }

  const resolvedUrl = officialUrl || rawUrl;
  if (!resolvedUrl) {
    return {
      url: "",
      official_url: "",
      pdf_url: "",
      discovery_url: rawDiscoveryUrl,
      link_status: "missing",
      link_note: "article_link_missing",
    };
  }

  return {
    url: resolvedUrl,
    official_url: resolvedUrl,
    pdf_url: isPdfUrl(resolvedUrl) ? resolvedUrl : "",
    discovery_url: rawDiscoveryUrl,
    link_status: isPdfUrl(resolvedUrl) ? "official_pdf" : "official_detail",
    link_note: isPdfUrl(resolvedUrl) ? "official_pdf_resolved" : "official_detail_page",
  };
}
