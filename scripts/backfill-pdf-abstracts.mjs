import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, unlink, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const dataDir = new URL("../data/", import.meta.url);
const historyPath = new URL("../data/push-history.json", import.meta.url);
const cacheDir = new URL("../data/.pdf-cache/abstract-backfill/", import.meta.url);
const ocrCacheDir = new URL("../data/.pdf-cache/abstract-backfill-ocr/", import.meta.url);

const PYTHON_EXTRACT_TEXT = `
import sys
from pypdf import PdfReader

path = sys.argv[1]
pages = int(sys.argv[2])
reader = PdfReader(path)
texts = []
for index, page in enumerate(reader.pages[:pages]):
    try:
        texts.append(page.extract_text() or "")
    except Exception:
        texts.append("")
sys.stdout.write("\\n".join(texts))
`;

function cliValue(name) {
  return process.argv.slice(2).find((arg) => arg.startsWith(`${name}=`))?.slice(name.length + 1);
}

function cliFlag(name) {
  return process.argv.slice(2).includes(name);
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function pythonCandidates() {
  return [
    process.env.PDF_BACKFILL_PYTHON,
    `${homedir()}/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3`,
    process.env.PYTHON,
    "python3",
  ].filter(Boolean);
}

function resolvePythonBin() {
  return pythonCandidates().find((candidate) => candidate === "python3" || existsSync(candidate)) || "python3";
}

function resolveExecutable(name) {
  if (name.includes("/") && existsSync(name)) return name;
  for (const dir of [...(process.env.PATH || "").split(delimiter), "/opt/homebrew/bin", "/usr/local/bin"]) {
    if (!dir) continue;
    const candidate = join(dir, name);
    if (existsSync(candidate)) return candidate;
  }
  return "";
}

function compactText(value = "") {
  return String(value)
    .replace(/[\u3000\xa0]/g, " ")
    .replace(/(?<=[\u3400-\u9fff])\s+(?=[\u3400-\u9fff])/g, "")
    .replace(/\s+([，。；：！？、）])/g, "$1")
    .replace(/([（])\s+/g, "$1")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function oneLine(value = "") {
  return compactText(value)
    .replace(/\s*\n\s*/g, " ")
    .replace(/([。！？；，、])\s+(?=[\u3400-\u9fff])/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

function splitKeywords(value = "") {
  const normalized = String(value)
    .replace(/^(?:关\s*键\s*词|关键词|Key\s*words?|Keywords)\s*[:：]?\s*/i, "")
    .replace(/\s*(?:中图分类号|JEL|一\s*[、.．]|引\s*言|参考文献)[\s\S]*$/i, "")
    .replace(/\s*\n\s*/g, " ")
    .trim();
  const seen = new Set();
  const keywords = [];
  for (const raw of normalized.split(/[\s,，、;；]+/)) {
    const keyword = raw.trim();
    const key = keyword.toLowerCase();
    if (!keyword || seen.has(key)) continue;
    seen.add(key);
    keywords.push(keyword);
  }
  const singleCjkTokens = keywords.filter((keyword) => /^[\u3400-\u9fff]$/.test(keyword)).length;
  if (keywords.length > 10 || singleCjkTokens > Math.max(2, keywords.length / 3)) return [];
  return keywords;
}

export function parsePdfAbstractText(text = "") {
  const source = String(text).replace(/\r/g, "\n").replace(/[\u00a0]/g, " ");
  const abstractLabel = /(?:内\s*容\s*提\s*要|摘\s*要)\s*[:：]?/i;
  const keywordLabel = /(?:关\s*键\s*词|关键词|Key\s*words?|Keywords)\s*[:：]?/i;
  const abstractMatch = source.match(abstractLabel);
  if (!abstractMatch?.index && abstractMatch?.index !== 0) return {};

  const afterAbstract = source.slice(abstractMatch.index + abstractMatch[0].length);
  const keywordMatch = afterAbstract.match(keywordLabel);
  const abstractBlock = keywordMatch
    ? afterAbstract.slice(0, keywordMatch.index)
    : afterAbstract.split(/\n\s*(?:一\s*[、.．]|引\s*言|Introduction)\s*/i)[0] || "";
  const abstract = oneLine(abstractBlock);
  if (abstract.length < 40 || /^(目录|参考文献|下载|版权所有)/.test(abstract)) return {};

  const result = { abstract };
  if (keywordMatch) {
    const afterKeywords = afterAbstract.slice(keywordMatch.index + keywordMatch[0].length);
    const keywordBlock = afterKeywords.split(/\n\s*(?:一\s*[、.．]|引\s*言|中图分类号|JEL|Abstract|参考文献|\*)/i)[0] || "";
    const keywords = splitKeywords(keywordBlock);
    if (keywords.length) result.keywords = keywords;
  }
  return result;
}

function articleUrl(article) {
  return article.url || article.official_url || article.pdf_url || "";
}

function selectedJournals() {
  return (cliValue("--journals") || "经济研究,中国农村经济")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

function targetArticles(history) {
  const journals = new Set(selectedJournals());
  const limit = Number(cliValue("--limit") || 0);
  const firstSeenAt = cliValue("--first-seen-at") || "";
  const articles = (history.articles || [])
    .filter((article) => journals.has(article.journal_name))
    .filter((article) => !article.abstract)
    .filter((article) => !firstSeenAt || article.first_seen_at === firstSeenAt)
    .filter((article) => /\.pdf(?:$|[?#])/i.test(articleUrl(article)));
  return limit > 0 ? articles.slice(0, limit) : articles;
}

async function fetchPdf(article, timeoutMs) {
  await mkdir(cacheDir, { recursive: true });
  const cachePath = new URL(`${article.id}.pdf`, cacheDir);
  const cacheFile = fileURLToPath(cachePath);
  if (existsSync(cacheFile)) return cachePath;
  const url = articleUrl(article);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      redirect: "follow",
      headers: {
        "User-Agent": "Mozilla/5.0 ScienceWorkshop/0.2",
        Accept: "application/pdf,*/*;q=0.8",
      },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`pdf_status_${response.status}`);
    const buffer = Buffer.from(await response.arrayBuffer());
    await writeFile(cachePath, buffer);
    return cachePath;
  } catch (error) {
    if (!cliFlag("--no-curl")) {
      const curlTimeout = String(Math.ceil((timeoutMs + 15000) / 1000));
      try {
        await execFileAsync("curl", [
          "-L",
          "--http1.1",
          "--max-time",
          curlTimeout,
          "-sS",
          "-A",
          "Mozilla/5.0 ScienceWorkshop/0.2",
          "-H",
          "Accept: application/pdf,*/*;q=0.8",
          "-o",
          cacheFile,
          url,
        ], {
          timeout: timeoutMs + 20000,
          maxBuffer: 2 * 1024 * 1024,
        });
        if (existsSync(cacheFile)) return cachePath;
      } catch (curlError) {
        await unlink(cacheFile).catch(() => {});
        throw curlError;
      }
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function extractPdfText(pdfPath, options = {}) {
  const pythonBin = resolvePythonBin();
  const pages = String(options.pages || 3);
  const timeout = options.timeoutMs || 15000;
  const { stdout } = await execFileAsync(pythonBin, ["-c", PYTHON_EXTRACT_TEXT, fileURLToPath(pdfPath), pages], {
    timeout,
    maxBuffer: 16 * 1024 * 1024,
  });
  return stdout;
}

async function extractPdfOcrText(pdfPath, article, options = {}) {
  const pdftoppm = resolveExecutable("pdftoppm");
  const tesseract = resolveExecutable("tesseract");
  if (!pdftoppm || !tesseract) throw new Error("ocr_tools_missing");

  const pages = options.pages || 3;
  const dpi = options.ocrDpi || 220;
  const lang = options.ocrLang || "chi_sim+eng";
  const timeout = options.ocrTimeoutMs || 120000;
  const cacheKey = `${article.id}-p${pages}-r${dpi}-${lang.replace(/[^\w.-]+/g, "_")}`;
  const textCache = new URL(`${cacheKey}.txt`, ocrCacheDir);
  if (existsSync(fileURLToPath(textCache))) return readFile(textCache, "utf8");

  await mkdir(ocrCacheDir, { recursive: true });
  const prefix = fileURLToPath(new URL(`${cacheKey}`, ocrCacheDir));
  await execFileAsync(pdftoppm, [
    "-f",
    "1",
    "-l",
    String(pages),
    "-r",
    String(dpi),
    "-png",
    fileURLToPath(pdfPath),
    prefix,
  ], {
    timeout,
    maxBuffer: 2 * 1024 * 1024,
  });

  const dir = fileURLToPath(ocrCacheDir);
  const images = (await readdir(dir))
    .filter((name) => name.startsWith(`${cacheKey}-`) && name.endsWith(".png"))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
    .map((name) => join(dir, name));

  const texts = [];
  for (const image of images) {
    const { stdout } = await execFileAsync(tesseract, [
      image,
      "stdout",
      "-l",
      lang,
      "--psm",
      "6",
    ], {
      timeout,
      maxBuffer: 16 * 1024 * 1024,
    });
    texts.push(stdout);
  }
  const text = texts.join("\n");
  await writeFile(textCache, text, "utf8");
  return text;
}

async function processArticle(article, options = {}) {
  try {
    const pdfPath = await fetchPdf(article, options.fetchTimeoutMs);
    let text = "";
    let textError = "";
    try {
      text = await extractPdfText(pdfPath, {
        pages: options.pages,
        timeoutMs: options.extractTimeoutMs,
      });
    } catch (error) {
      textError = error.signal === "SIGTERM" ? "pdf_extract_timeout" : error.message;
    }
    let hints = parsePdfAbstractText(text);
    let extractionMethod = "pdf_text";
    let ocrError = "";
    if (!hints.abstract && options.ocr) {
      try {
        const ocrText = await extractPdfOcrText(pdfPath, article, options);
        hints = parsePdfAbstractText(ocrText);
        extractionMethod = "pdf_ocr";
      } catch (error) {
        ocrError = error.signal === "SIGTERM" ? "ocr_timeout" : error.message;
      }
    }
    const patched = { ...article };
    if (hints.abstract) patched.abstract = hints.abstract;
    if (hints.keywords?.length) patched.keywords = hints.keywords;
    return {
      article: patched,
      addedAbstract: Boolean(hints.abstract),
      keywords: hints.keywords?.length || 0,
      cache_path: fileURLToPath(pdfPath),
      extraction_method: hints.abstract ? extractionMethod : "",
      error: hints.abstract ? "" : ocrError || textError,
    };
  } catch (error) {
    return {
      article,
      addedAbstract: false,
      keywords: 0,
      error: error.signal === "SIGTERM" ? "pdf_extract_timeout" : error.message,
    };
  }
}

async function main() {
  const history = JSON.parse(await readFile(historyPath, "utf8"));
  const articles = targetArticles(history);
  const output = cliValue("--output") || `data/recent-articles-pdf-abstract-backfill-${today()}.json`;
  const options = {
    fetchTimeoutMs: Number(cliValue("--fetch-timeout-ms") || 25000),
    extractTimeoutMs: Number(cliValue("--extract-timeout-ms") || 15000),
    pages: Number(cliValue("--pages") || 3),
    ocr: cliFlag("--ocr"),
    ocrLang: cliValue("--ocr-lang") || "chi_sim+eng",
    ocrDpi: Number(cliValue("--ocr-dpi") || 220),
    ocrTimeoutMs: Number(cliValue("--ocr-timeout-ms") || 120000),
  };

  const results = [];
  for (const article of articles) {
    const result = await processArticle(article, options);
    results.push(result);
    console.log(JSON.stringify({
      journal: article.journal_name,
      title: article.title.slice(0, 36),
      abstract: result.addedAbstract,
      keywords: result.keywords,
      method: result.extraction_method || "",
      error: result.error || "",
    }));
  }

  const pushQueue = results.filter((result) => result.addedAbstract).map((result) => result.article);
  const workflow = {
    summary: {
      checked_at: new Date().toISOString(),
      since: "2000-01-01",
      until: today(),
      sources_total: history.summary?.sources_total || 22,
      sources_ready: history.summary?.sources_ready || 20,
      push_queue_articles: pushQueue.length,
      abstract_backfill: true,
      pdf_backfill: true,
      pdf_ocr_backfill: options.ocr,
      backfill_sources: selectedJournals(),
    },
    push_queue: pushQueue,
    results,
  };

  if (!cliFlag("--dry-run")) {
    await writeFile(new URL(output, `file://${process.cwd()}/`), `${JSON.stringify(workflow, null, 2)}\n`, "utf8");
  }
  console.log(`WROTE ${pushQueue.length}/${articles.length} ${output}`);
}

if (process.argv[1] && import.meta.url === new URL(process.argv[1], "file://").href) {
  await main();
}
