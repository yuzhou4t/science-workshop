import { execFile } from "node:child_process";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
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

const source = await readFile(new URL("./backfill-daily-abstracts.mjs", import.meta.url), "utf8");
assert.match(source, /timeout: options\.timeoutMs/, "daily abstract backfill steps should have process-level timeouts");
assert.match(source, /timed_out/, "daily abstract backfill summary should report timed out steps");

console.log("daily abstract backfill rules ok");
