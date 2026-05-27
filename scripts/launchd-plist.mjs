import path from "node:path";

export const DAILY_WORKFLOW_LABEL = "com.science-workshop.daily";
export const DAILY_WORKFLOW_HOUR = 10;
export const DAILY_WORKFLOW_MINUTE = 0;

function assertClockPart(name, value, max) {
  if (!Number.isInteger(value) || value < 0 || value > max) {
    throw new Error(`${name} must be an integer between 0 and ${max}`);
  }
}

function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&apos;");
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

export function dailyWorkflowPlist({
  label = DAILY_WORKFLOW_LABEL,
  nodePath = process.execPath,
  projectDir,
  hour = DAILY_WORKFLOW_HOUR,
  minute = DAILY_WORKFLOW_MINUTE,
} = {}) {
  if (!projectDir) {
    throw new Error("projectDir is required");
  }
  assertClockPart("hour", hour, 23);
  assertClockPart("minute", minute, 59);

  const logPath = path.join(projectDir, "logs", "daily-workflow.log");
  const errorLogPath = path.join(projectDir, "logs", "daily-workflow.error.log");
  const environmentPath = unique([
    path.dirname(nodePath),
    "/opt/homebrew/bin",
    "/usr/local/bin",
    "/usr/bin",
    "/bin",
    "/usr/sbin",
    "/sbin",
  ]).join(":");

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${escapeXml(label)}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${escapeXml(nodePath)}</string>
    <string>scripts/run-daily-workflow.mjs</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${escapeXml(projectDir)}</string>
  <key>StartCalendarInterval</key>
  <dict>
    <key>Hour</key>
    <integer>${hour}</integer>
    <key>Minute</key>
    <integer>${minute}</integer>
  </dict>
  <key>RunAtLoad</key>
  <false/>
  <key>KeepAlive</key>
  <false/>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>${escapeXml(environmentPath)}</string>
  </dict>
  <key>StandardOutPath</key>
  <string>${escapeXml(logPath)}</string>
  <key>StandardErrorPath</key>
  <string>${escapeXml(errorLogPath)}</string>
</dict>
</plist>
`;
}
