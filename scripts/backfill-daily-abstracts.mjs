import { execFile } from "node:child_process";
import { readFile, unlink, writeFile } from "node:fs/promises";
import { promisify } from "node:util";

import { dateOnly } from "./recent-workflow-lib.mjs";

const execFileAsync = promisify(execFile);
const today = dateOnly(new Date());

function cliValue(name) {
  return process.argv.slice(2).find((arg) => arg.startsWith(`${name}=`))?.slice(name.length + 1);
}

function cliFlag(name) {
  return process.argv.slice(2).includes(name);
}

async function readJsonIfExists(path) {
  try {
    return JSON.parse(await readFile(new URL(path, import.meta.url), "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return {};
    throw error;
  }
}

async function runNodeScript(script, args = [], options = {}) {
  try {
    const { stdout, stderr } = await execFileAsync(process.execPath, [script, ...args], {
      cwd: new URL("..", import.meta.url),
      maxBuffer: 64 * 1024 * 1024,
      timeout: options.timeoutMs,
    });
    if (stdout) process.stdout.write(stdout);
    if (stderr) process.stderr.write(stderr);
    return { ok: true };
  } catch (error) {
    if (error.stdout) process.stdout.write(error.stdout);
    if (error.stderr) process.stderr.write(error.stderr);
    const timedOut = error.signal === "SIGTERM" || error.killed;
    const message = timedOut
      ? `abstract backfill step timed out after ${options.timeoutMs}ms`
      : `abstract backfill step failed`;
    console.error(`${message}: ${script}: ${error.message}`);
    return { ok: false, error: error.message, timedOut };
  }
}

async function workflowPushCount(path) {
  const workflow = await readJsonIfExists(`../${path}`);
  return workflow.summary?.push_queue_articles || workflow.push_queue?.length || 0;
}

async function missingAbstracts() {
  const history = await readJsonIfExists("../data/push-history.json");
  return (history.articles || []).filter((article) => !String(article.abstract || "").trim());
}

function reportFailure(result = {}) {
  const response = result.response || {};
  return result.error || response.error || (result.addedAbstract ? "" : "no_abstract_found");
}

async function writeReport(path, beforeCount, steps, scope = {}) {
  const byJournal = {};
  const bySource = {};
  const byFailure = {};
  for (const step of steps) {
    bySource[step.name] ||= { checked: 0, added: 0, failed: 0 };
    if (!step.ok) {
      bySource[step.name].failed += 1;
      const failure = step.timedOut ? "step_timeout" : "step_failed";
      byFailure[failure] = (byFailure[failure] || 0) + 1;
    }
    let workflow = {};
    try {
      workflow = await readJsonIfExists(`../${step.output}`);
    } catch {
      workflow = {};
    }
    for (const result of workflow.results || []) {
      const article = result.article || {};
      const source = step.name;
      bySource[source] ||= { checked: 0, added: 0, failed: 0 };
      bySource[source].checked += 1;
      if (result.addedAbstract) bySource[source].added += 1;
      else {
        bySource[source].failed += 1;
        const failure = reportFailure(result);
        byFailure[failure] = (byFailure[failure] || 0) + 1;
      }
      // Some adapters emit journal-level discovery diagnostics without an
      // article. Keep those in by_source/by_failure, but don't inflate the
      // per-journal article gap counts.
      if (!article.id) continue;
      const journal = article.journal_name || result.journal || "unknown";
      byJournal[journal] ||= { checked: 0, added: 0, remaining: 0 };
      byJournal[journal].checked += 1;
      if (result.addedAbstract) byJournal[journal].added += 1;
    }
  }
  const allRemaining = await missingAbstracts();
  const remaining = scope.all
    ? allRemaining
    : allRemaining.filter((article) => article.first_seen_at === scope.firstSeenAt);
  for (const article of remaining) {
    const journal = article.journal_name || "unknown";
    byJournal[journal] ||= { checked: 0, added: 0, remaining: 0 };
    byJournal[journal].remaining += 1;
  }
  const report = {
    generated_at: new Date().toISOString(),
    abstract_backfill_report: true,
    missing_before: beforeCount,
    missing_after: remaining.length,
    added_abstracts: Math.max(0, beforeCount - remaining.length),
    by_journal: byJournal,
    by_source: bySource,
    failure_reasons: byFailure,
    remaining_articles: remaining.map((article) => ({
      id: article.id,
      journal_name: article.journal_name,
      title: article.title,
      first_seen_at: article.first_seen_at,
      issue_date: article.issue_date || "",
      url: article.url || article.official_url || article.pdf_url || "",
    })),
  };
  await writeFile(new URL(path, `file://${process.cwd()}/`), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  return report;
}

async function runBackfillStep(step) {
  // Never let a failed/restarted step make the report consume yesterday's
  // workflow file with the same date.
  await unlink(new URL(`../${step.output}`, import.meta.url)).catch((error) => {
    if (error.code !== "ENOENT") throw error;
  });
  const result = await runNodeScript(step.script, step.args, { timeoutMs: step.timeoutMs });
  const pushCount = await workflowPushCount(step.output);
  if (pushCount > 0) {
    await runNodeScript("scripts/build-front-data.mjs", [`--workflow=${step.output}`]);
  }
  return { ...step, ...result, pushCount };
}

const firstSeenAt = cliValue("--first-seen-at") || today;
const allMissing = cliFlag("--all-missing");
const outputDate = cliValue("--output-date") || today;
const includeOcr = !cliFlag("--skip-ocr");
const scopeArgs = allMissing ? [] : [`--first-seen-at=${firstSeenAt}`];
const delayOverride = cliValue("--delay-ms");
const delayArgs = delayOverride ? [`--delay-ms=${delayOverride}`] : [];

const steps = [
  {
    name: "ncpssd-direct",
    script: "scripts/backfill-ncpssd-abstracts.mjs",
    output: `data/recent-articles-daily-ncpssd-direct-${outputDate}.json`,
    args: [
      ...scopeArgs,
      ...delayArgs,
      `--output=data/recent-articles-daily-ncpssd-direct-${outputDate}.json`,
      "--timeout-ms=30000",
      "--delay-ms=8000",
      "--retries=3",
      ...delayArgs,
    ],
    timeoutMs: 4 * 60 * 1000,
  },
  {
    name: "ncpssd-issue",
    script: "scripts/backfill-ncpssd-issue-abstracts.mjs",
    output: `data/recent-articles-daily-ncpssd-issue-${outputDate}.json`,
    args: [
      ...scopeArgs,
      ...delayArgs,
      "--journals=中国工业经济,会计研究,南开管理评论",
      `--output=data/recent-articles-daily-ncpssd-issue-${outputDate}.json`,
      "--timeout-ms=25000",
      "--delay-ms=5000",
      "--retries=3",
      ...delayArgs,
    ],
    timeoutMs: 4 * 60 * 1000,
  },
  {
    name: "official-html",
    script: "scripts/backfill-official-html-abstracts.mjs",
    output: `data/recent-articles-daily-official-html-${outputDate}.json`,
    args: [
      ...scopeArgs,
      ...delayArgs,
      `--output=data/recent-articles-daily-official-html-${outputDate}.json`,
      "--timeout-ms=15000",
      "--delay-ms=300",
      ...delayArgs,
    ],
    timeoutMs: 4 * 60 * 1000,
  },
  {
    name: "pdf",
    script: "scripts/backfill-pdf-abstracts.mjs",
    output: `data/recent-articles-daily-pdf-${outputDate}.json`,
    args: [
      ...scopeArgs,
      ...delayArgs,
      "--journals=经济研究,中国农村经济,中国工业经济,会计研究",
      `--output=data/recent-articles-daily-pdf-${outputDate}.json`,
      "--fetch-timeout-ms=180000",
      "--extract-timeout-ms=10000",
      "--pages=3",
      ...(includeOcr ? ["--ocr", "--ocr-timeout-ms=120000", "--ocr-dpi=220"] : []),
      ...delayArgs,
    ],
    timeoutMs: 6 * 60 * 1000,
  },
  {
    name: "english-metadata",
    script: "scripts/backfill-english-metadata-abstracts.mjs",
    output: `data/recent-articles-daily-english-metadata-${outputDate}.json`,
    args: [
      ...scopeArgs,
      ...delayArgs,
      `--output=data/recent-articles-daily-english-metadata-${outputDate}.json`,
      "--semantic-scholar",
      "--timeout-ms=15000",
      "--delay-ms=1200",
      ...delayArgs,
    ],
    timeoutMs: 3 * 60 * 1000,
  },
  {
    name: "macrodatas",
    script: "scripts/backfill-macrodatas-abstracts.mjs",
    output: `data/recent-articles-daily-macrodatas-${outputDate}.json`,
    args: [
      ...scopeArgs,
      ...delayArgs,
      "--journals=中国工业经济,会计研究,南开管理评论",
      `--output=data/recent-articles-daily-macrodatas-${outputDate}.json`,
      "--timeout-ms=15000",
      "--delay-ms=1500",
      ...delayArgs,
    ],
    timeoutMs: 3 * 60 * 1000,
  },
];

const history = await readJsonIfExists("../data/push-history.json");
const missingBefore = (history.articles || [])
  .filter((article) => !String(article.abstract || "").trim())
  .filter((article) => allMissing || article.first_seen_at === firstSeenAt);
if (!missingBefore.length) {
  console.log(allMissing ? "No missing abstracts." : `No missing abstracts for first_seen_at=${firstSeenAt}.`);
  process.exit(0);
}

console.log(allMissing
  ? `Backfilling abstracts for all ${missingBefore.length} missing articles.`
  : `Backfilling abstracts for ${missingBefore.length} articles first_seen_at=${firstSeenAt}.`);
const results = [];
for (const step of steps) {
  results.push(await runBackfillStep(step));
  const remaining = await missingAbstracts();
  console.log(`After ${step.name}: ${remaining.length} abstracts remain missing.`);
}

const totalAdded = results.reduce((sum, result) => sum + result.pushCount, 0);
// Abstracts participate in topic extraction, so regenerate the cumulative
// index once after all ordered enrichment steps have settled.
await runNodeScript("scripts/build-topic-search-index.mjs");
const reportPath = cliValue("--report") || `data/abstract-backfill-report-${outputDate}.json`;
const report = await writeReport(reportPath, missingBefore.length, results, { all: allMissing, firstSeenAt });
console.log(JSON.stringify({
  daily_abstract_backfill: true,
  all_missing: allMissing,
  first_seen_at: allMissing ? "" : firstSeenAt,
  missing_before: missingBefore.length,
  missing_after: report.missing_after,
  added_abstracts: Math.max(totalAdded, report.added_abstracts),
  report: reportPath,
  steps: results.map((result) => ({
    name: result.name,
    ok: result.ok,
    added: result.pushCount,
    timed_out: Boolean(result.timedOut),
  })),
}, null, 2));
