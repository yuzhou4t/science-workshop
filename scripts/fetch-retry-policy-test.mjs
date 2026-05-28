import assert from "node:assert/strict";

import { shouldRetryWithCurlStatus } from "./fetch-retry-policy.mjs";

assert.equal(shouldRetryWithCurlStatus(503), true);
assert.equal(shouldRetryWithCurlStatus(504), true);
assert.equal(shouldRetryWithCurlStatus(429), true);
assert.equal(shouldRetryWithCurlStatus(403), true);
assert.equal(shouldRetryWithCurlStatus(404), false);
assert.equal(shouldRetryWithCurlStatus(200), false);

console.log("fetch retry policy ok");
