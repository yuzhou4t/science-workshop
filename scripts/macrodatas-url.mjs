export function macrodatasArticleSectionUrl(pageUrl, title) {
  const baseUrl = String(pageUrl || "").split("#")[0];
  const text = String(title || "").trim();
  if (!baseUrl || !text) return baseUrl;
  return `${baseUrl}#:~:text=${encodeURIComponent(text)}`;
}
