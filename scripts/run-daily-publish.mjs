import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { dateOnly } from "./recent-workflow-lib.mjs";

const execFileAsync = promisify(execFile);
const projectDir = new URL("..", import.meta.url);
const today = dateOnly(new Date());
const remote = process.env.SCIENCE_WORKSHOP_PUBLISH_REMOTE || "origin";
const branch = process.env.SCIENCE_WORKSHOP_PUBLISH_BRANCH || "main";
const dailyGeneratedFiles = [
  "data/fetch-smoke-results.json",
  "data/source-state.json",
  "data/push-history.json",
  "data/recent-front-data.js",
  "data/topic-search-index.js",
  `data/recent-articles-${today}_${today}.json`,
  `data/recent-articles-daily-ncpssd-direct-${today}.json`,
  `data/recent-articles-daily-ncpssd-issue-${today}.json`,
  `data/recent-articles-daily-pdf-${today}.json`,
  `data/recent-articles-daily-english-metadata-${today}.json`,
  `data/recent-articles-daily-macrodatas-${today}.json`,
];
const publishableFiles = new Set(dailyGeneratedFiles);

async function run(command, args, options = {}) {
  const { stdout, stderr } = await execFileAsync(command, args, {
    cwd: projectDir,
    maxBuffer: 64 * 1024 * 1024,
    ...options,
  });
  if (options.inheritOutput !== false) {
    if (stdout) process.stdout.write(stdout);
    if (stderr) process.stderr.write(stderr);
  }
  return { stdout, stderr };
}

async function git(args, options = {}) {
  return run("git", args, options);
}

function parsePorcelain(stdout) {
  return stdout
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const path = line.slice(3).split(" -> ").at(-1);
      return { status: line.slice(0, 2), path };
    });
}

async function currentBranch() {
  const { stdout } = await git(["branch", "--show-current"], { inheritOutput: false });
  return stdout.trim();
}

async function stagedFiles() {
  const { stdout } = await git(["diff", "--cached", "--name-only"], { inheritOutput: false });
  return stdout.split("\n").filter(Boolean);
}

async function publishGeneratedData() {
  const stagedBefore = await stagedFiles();
  if (stagedBefore.length) {
    console.log(`Skip auto publish: staged changes already exist (${stagedBefore.join(", ")}).`);
    return;
  }

  const { stdout } = await git(["status", "--porcelain=v1", "--untracked-files=all"], { inheritOutput: false });
  const publishableChanges = parsePorcelain(stdout)
    .filter((entry) => publishableFiles.has(entry.path))
    .map((entry) => entry.path);

  if (!publishableChanges.length) {
    console.log("No generated daily data changes to publish.");
    return;
  }

  await git(["add", "--", ...publishableChanges]);

  const stagedAfterAdd = await stagedFiles();
  const unexpected = stagedAfterAdd.filter((file) => !publishableFiles.has(file));
  if (unexpected.length) {
    await git(["restore", "--staged", "--", ...stagedAfterAdd]);
    throw new Error(`Refusing to auto publish unexpected staged files: ${unexpected.join(", ")}`);
  }

  await git(["commit", "-m", `chore(data): publish daily articles ${today}`]);
  await git(["push", remote, branch]);
  console.log(`Published ${stagedAfterAdd.length} generated data file(s) to ${remote}/${branch}.`);
}

const branchName = await currentBranch();
if (branchName !== branch) {
  throw new Error(`Refusing to run daily publish on branch ${branchName || "(detached)"}; expected ${branch}.`);
}

await run(process.execPath, ["scripts/run-daily-workflow.mjs"]);
await publishGeneratedData();
