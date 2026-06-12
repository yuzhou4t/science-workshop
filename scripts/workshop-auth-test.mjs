import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { Readable } from "node:stream";

const require = createRequire(import.meta.url);

const {
  createSessionCookie,
  isProtectedBackendPath,
  readJsonBody,
  readSession,
  verifyPasswordHash,
} = require("../api/workshop-auth.js");

process.env.WORKSHOP_SESSION_SECRET = "test-session-secret-with-enough-length";

const passwordHash = "scrypt:science-workshop-test-salt:1E77spjL2vi7jFFtfCGwevbNJsMf2-qJVUcuBEMcC0Q";

assert.equal(verifyPasswordHash("test-password", passwordHash), true);
assert.equal(verifyPasswordHash("wrong-password", passwordHash), false);

const now = Date.parse("2026-06-13T00:00:00.000Z");
const cookieHeader = createSessionCookie("4tc", { now, secure: true });
const cookieValue = cookieHeader.match(/science_workshop_session=([^;]+)/)?.[1];

assert.ok(cookieValue);
assert.match(cookieHeader, /HttpOnly/);
assert.match(cookieHeader, /Secure/);
assert.match(cookieHeader, /SameSite=Lax/);

assert.deepEqual(readSession(`science_workshop_session=${cookieValue}`, { now: now + 1000 }), {
  username: "4tc",
});
assert.equal(readSession("", { now: now + 1000 }), null);
assert.equal(readSession(`science_workshop_session=${cookieValue}`, { now: now + 9 * 60 * 60 * 1000 }), null);

assert.equal(isProtectedBackendPath("/science-workshop-api/api/workflows/paper-reading/jobs"), true);
assert.equal(isProtectedBackendPath("/science-workshop-api/api/jobs/job-1/artifacts/final.md"), true);
assert.equal(isProtectedBackendPath("/science-workshop-api/api/health"), false);
assert.deepEqual(await readJsonBody({ body: '{"username":"4tc"}' }), { username: "4tc" });

function createMockResponse() {
  return {
    headers: {},
    statusCode: 0,
    setHeader(name, value) {
      this.headers[name.toLowerCase()] = value;
    },
    end(body = "") {
      this.body = body;
      this.ended = true;
    },
  };
}

process.env.SCIENCE_WORKSHOP_PROXY_SECRET = "proxy-secret";
process.env.SCIENCE_WORKSHOP_BACKEND_ORIGIN = "http://backend.local";
process.env.WORKSHOP_AUTH_USERNAME = "4tc";
process.env.WORKSHOP_AUTH_PASSWORD_HASH = passwordHash;
delete require.cache[require.resolve("../api/science-workshop-proxy.js")];
const proxy = require("../api/science-workshop-proxy.js");
const login = require("../api/auth/login.js");

const loginRequest = Readable.from([JSON.stringify({ username: "4tc", password: "test-password" })]);
loginRequest.method = "POST";
loginRequest.headers = { "x-forwarded-proto": "https" };
const loginResponse = createMockResponse();
await login(loginRequest, loginResponse);

assert.equal(loginResponse.statusCode, 200);
assert.match(loginResponse.headers["set-cookie"], /science_workshop_session=/);
assert.match(loginResponse.headers["set-cookie"], /Secure/);

const unauthorizedResponse = createMockResponse();
await proxy(
  {
    method: "GET",
    url: "/science-workshop-api/api/jobs/job-1",
    headers: {},
  },
  unauthorizedResponse,
);

assert.equal(unauthorizedResponse.statusCode, 401);
assert.equal(JSON.parse(unauthorizedResponse.body).detail, "Unauthorized");

let forwardedSecret = "";
const originalFetch = globalThis.fetch;
globalThis.fetch = async (_target, options) => {
  forwardedSecret = options.headers.get("x-science-workshop-proxy-secret");
  return new Response(null, { status: 204 });
};

const authorizedResponse = createMockResponse();
await proxy(
  {
    method: "GET",
    url: "/science-workshop-api/api/jobs/job-1",
    headers: {
      cookie: `science_workshop_session=${cookieValue}`,
      "x-science-workshop-proxy-secret": "client-spoofed-secret",
    },
  },
  authorizedResponse,
);
globalThis.fetch = originalFetch;

assert.equal(authorizedResponse.statusCode, 204);
assert.equal(forwardedSecret, "proxy-secret");

console.log("workshop auth helpers ok");
