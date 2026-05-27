import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import {
  DAILY_WORKFLOW_HOUR,
  DAILY_WORKFLOW_LABEL,
  DAILY_WORKFLOW_MINUTE,
  dailyWorkflowPlist,
} from "./launchd-plist.mjs";

const execFileAsync = promisify(execFile);

const projectDir = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const launchAgentsDir = path.join(os.homedir(), "Library", "LaunchAgents");
const plistPath = path.join(launchAgentsDir, `${DAILY_WORKFLOW_LABEL}.plist`);
const guiTarget = `gui/${os.userInfo().uid}`;

async function runLaunchctl(args, { ignoreFailure = false } = {}) {
  try {
    return await execFileAsync("launchctl", args, { maxBuffer: 8 * 1024 * 1024 });
  } catch (error) {
    if (ignoreFailure) return error;
    throw error;
  }
}

await mkdir(path.join(projectDir, "logs"), { recursive: true });
await mkdir(launchAgentsDir, { recursive: true });

await writeFile(
  plistPath,
  dailyWorkflowPlist({
    label: DAILY_WORKFLOW_LABEL,
    nodePath: process.execPath,
    projectDir,
    hour: DAILY_WORKFLOW_HOUR,
    minute: DAILY_WORKFLOW_MINUTE,
  }),
  "utf8",
);

await runLaunchctl(["bootout", guiTarget, plistPath], { ignoreFailure: true });
await runLaunchctl(["bootstrap", guiTarget, plistPath]);
await runLaunchctl(["enable", `${guiTarget}/${DAILY_WORKFLOW_LABEL}`]);

console.log(`Installed ${DAILY_WORKFLOW_LABEL}`);
console.log(`Plist: ${plistPath}`);
console.log(`Schedule: every day at ${String(DAILY_WORKFLOW_HOUR).padStart(2, "0")}:${String(DAILY_WORKFLOW_MINUTE).padStart(2, "0")}`);
console.log(`Workflow: ${path.join(projectDir, "scripts", "run-daily-workflow.mjs")}`);
console.log(`Logs: ${path.join(projectDir, "logs", "daily-workflow.log")}`);
console.log(`Errors: ${path.join(projectDir, "logs", "daily-workflow.error.log")}`);
