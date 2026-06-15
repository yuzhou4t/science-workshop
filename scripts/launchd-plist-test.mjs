import assert from "node:assert/strict";

import { dailyWorkflowPlist } from "./launchd-plist.mjs";

const plist = dailyWorkflowPlist({
  label: "com.science-workshop.daily",
  nodePath: "/usr/local/bin/node",
  projectDir: "/Users/example/Science Workshop",
  hour: 11,
  minute: 0,
});

assert.match(plist, /<key>Label<\/key>\s*<string>com\.science-workshop\.daily<\/string>/);
assert.match(plist, /<key>StartCalendarInterval<\/key>[\s\S]*<key>Hour<\/key>\s*<integer>11<\/integer>[\s\S]*<key>Minute<\/key>\s*<integer>0<\/integer>/);
assert.match(plist, /<string>\/usr\/local\/bin\/node<\/string>/);
assert.match(plist, /<string>scripts\/run-daily-publish\.mjs<\/string>/);
assert.match(plist, /<key>WorkingDirectory<\/key>\s*<string>\/Users\/example\/Science Workshop<\/string>/);
assert.match(plist, /<key>StandardOutPath<\/key>\s*<string>\/Users\/example\/Science Workshop\/logs\/daily-workflow\.log<\/string>/);
assert.match(plist, /<key>StandardErrorPath<\/key>\s*<string>\/Users\/example\/Science Workshop\/logs\/daily-workflow\.error\.log<\/string>/);

console.log("launchd plist rules ok");
