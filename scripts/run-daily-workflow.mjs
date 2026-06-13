import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";

import { dateOnly } from "./recent-workflow-lib.mjs";

const execFileAsync = promisify(execFile);
const today = dateOnly(new Date());
const workflowFile = `data/recent-articles-${today}_${today}.json`;

async function readJsonIfExists(path) {
  try {
    return JSON.parse(await readFile(new URL(path, import.meta.url), "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return {};
    throw error;
  }
}

async function runNodeScript(script, args = []) {
  const { stdout, stderr } = await execFileAsync(process.execPath, [script, ...args], {
    cwd: new URL("..", import.meta.url),
    maxBuffer: 32 * 1024 * 1024,
  });
  if (stdout) process.stdout.write(stdout);
  if (stderr) process.stderr.write(stderr);
}

const previousState = await readJsonIfExists("../data/source-state.json");
const args = ["--workflow", "--daily"];
if (!previousState.daily_initialized) args.push("--baseline");

await runNodeScript("scripts/fetch-articles-smoke-test.mjs", args);

const workflow = JSON.parse(await readFile(new URL(`../${workflowFile}`, import.meta.url), "utf8"));
if (workflow.summary.push_queue_articles > 0) {
  await runNodeScript("scripts/build-front-data.mjs", [`--workflow=${workflowFile}`]);
  await runNodeScript("scripts/backfill-daily-abstracts.mjs", [`--first-seen-at=${today}`]);
} else if (!previousState.daily_initialized) {
  console.log(`Daily baseline initialized for ${today}; front data left unchanged.`);
} else {
  console.log(`No new push articles for ${today}; front data left unchanged.`);
}

await runNodeScript("scripts/build-topic-search-index.mjs");
