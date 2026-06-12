import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
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

async function runNodeScript(script, args = []) {
  try {
    const { stdout, stderr } = await execFileAsync(process.execPath, [script, ...args], {
      cwd: new URL("..", import.meta.url),
      maxBuffer: 64 * 1024 * 1024,
    });
    if (stdout) process.stdout.write(stdout);
    if (stderr) process.stderr.write(stderr);
    return { ok: true };
  } catch (error) {
    if (error.stdout) process.stdout.write(error.stdout);
    if (error.stderr) process.stderr.write(error.stderr);
    console.error(`abstract backfill step failed: ${script}: ${error.message}`);
    return { ok: false, error: error.message };
  }
}

async function workflowPushCount(path) {
  const workflow = await readJsonIfExists(`../${path}`);
  return workflow.summary?.push_queue_articles || workflow.push_queue?.length || 0;
}

async function runBackfillStep(step) {
  const result = await runNodeScript(step.script, step.args);
  const pushCount = await workflowPushCount(step.output);
  if (pushCount > 0) {
    await runNodeScript("scripts/build-front-data.mjs", [`--workflow=${step.output}`]);
  }
  return { ...step, ...result, pushCount };
}

const firstSeenAt = cliValue("--first-seen-at") || today;
const outputDate = firstSeenAt;
const includeOcr = !cliFlag("--skip-ocr");

const steps = [
  {
    name: "ncpssd-direct",
    script: "scripts/backfill-ncpssd-abstracts.mjs",
    output: `data/recent-articles-daily-ncpssd-direct-${outputDate}.json`,
    args: [
      `--first-seen-at=${firstSeenAt}`,
      `--output=data/recent-articles-daily-ncpssd-direct-${outputDate}.json`,
      "--timeout-ms=30000",
      "--delay-ms=8000",
      "--retries=3",
    ],
  },
  {
    name: "ncpssd-issue",
    script: "scripts/backfill-ncpssd-issue-abstracts.mjs",
    output: `data/recent-articles-daily-ncpssd-issue-${outputDate}.json`,
    args: [
      `--first-seen-at=${firstSeenAt}`,
      "--journals=中国工业经济,会计研究",
      `--output=data/recent-articles-daily-ncpssd-issue-${outputDate}.json`,
      "--timeout-ms=25000",
      "--delay-ms=5000",
      "--retries=3",
    ],
  },
  {
    name: "pdf",
    script: "scripts/backfill-pdf-abstracts.mjs",
    output: `data/recent-articles-daily-pdf-${outputDate}.json`,
    args: [
      `--first-seen-at=${firstSeenAt}`,
      "--journals=经济研究,中国农村经济",
      `--output=data/recent-articles-daily-pdf-${outputDate}.json`,
      "--fetch-timeout-ms=180000",
      "--extract-timeout-ms=10000",
      "--pages=3",
      ...(includeOcr ? ["--ocr", "--ocr-timeout-ms=120000", "--ocr-dpi=220"] : []),
    ],
  },
  {
    name: "english-metadata",
    script: "scripts/backfill-english-metadata-abstracts.mjs",
    output: `data/recent-articles-daily-english-metadata-${outputDate}.json`,
    args: [
      `--first-seen-at=${firstSeenAt}`,
      `--output=data/recent-articles-daily-english-metadata-${outputDate}.json`,
      "--timeout-ms=15000",
      "--delay-ms=1200",
    ],
  },
  {
    name: "macrodatas",
    script: "scripts/backfill-macrodatas-abstracts.mjs",
    output: `data/recent-articles-daily-macrodatas-${outputDate}.json`,
    args: [
      `--first-seen-at=${firstSeenAt}`,
      "--journals=中国工业经济,会计研究",
      `--output=data/recent-articles-daily-macrodatas-${outputDate}.json`,
      "--timeout-ms=15000",
      "--delay-ms=1500",
    ],
  },
];

const history = await readJsonIfExists("../data/push-history.json");
const missingToday = (history.articles || []).filter((article) => article.first_seen_at === firstSeenAt && !article.abstract);
if (!missingToday.length) {
  console.log(`No missing abstracts for first_seen_at=${firstSeenAt}.`);
  process.exit(0);
}

console.log(`Backfilling abstracts for ${missingToday.length} articles first_seen_at=${firstSeenAt}.`);
const results = [];
for (const step of steps) {
  results.push(await runBackfillStep(step));
}

const totalAdded = results.reduce((sum, result) => sum + result.pushCount, 0);
console.log(JSON.stringify({
  daily_abstract_backfill: true,
  first_seen_at: firstSeenAt,
  missing_before: missingToday.length,
  added_abstracts: totalAdded,
  steps: results.map((result) => ({ name: result.name, ok: result.ok, added: result.pushCount })),
}, null, 2));
