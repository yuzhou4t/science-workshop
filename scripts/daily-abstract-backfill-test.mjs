import { execFile } from "node:child_process";
import assert from "node:assert/strict";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const { stdout } = await execFileAsync(process.execPath, [
  "scripts/backfill-daily-abstracts.mjs",
  "--first-seen-at=1900-01-01",
  "--skip-ocr",
], {
  maxBuffer: 1024 * 1024,
});

assert.match(stdout, /No missing abstracts for first_seen_at=1900-01-01/);

console.log("daily abstract backfill rules ok");
