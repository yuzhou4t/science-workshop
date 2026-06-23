const crypto = require("node:crypto");

const COOKIE_NAME = "science_workshop_session";
const SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const PROXY_SECRET_HEADER = "x-science-workshop-proxy-secret";

function base64UrlJson(value) {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

function signPayload(payload, secret) {
  return crypto.createHmac("sha256", secret).update(payload).digest("base64url");
}

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(String(left || ""));
  const rightBuffer = Buffer.from(String(right || ""));
  if (leftBuffer.length !== rightBuffer.length) return false;
  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function sessionSecret() {
  return process.env.WORKSHOP_SESSION_SECRET || "";
}

function normalizeRole(role) {
  return role === "admin" ? "admin" : "user";
}

function inferSessionRole(username) {
  if (
    username
    && (
      username === process.env.WORKSHOP_ADMIN_USERNAME
      || username === process.env.WORKSHOP_AUTH_USERNAME
    )
  ) {
    return "admin";
  }
  return "user";
}

function createSessionToken(username, options = {}) {
  const secret = options.secret || sessionSecret();
  if (!secret) throw new Error("WORKSHOP_SESSION_SECRET is not configured");
  const now = Number(options.now || Date.now());
  const payload = base64UrlJson({
    sub: username,
    role: normalizeRole(options.role),
    iat: now,
    exp: now + SESSION_TTL_MS,
  });
  return `${payload}.${signPayload(payload, secret)}`;
}

function createSessionCookie(username, options = {}) {
  const maxAge = Math.floor(SESSION_TTL_MS / 1000);
  const token = createSessionToken(username, options);
  const parts = [
    `${COOKIE_NAME}=${token}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${maxAge}`,
  ];
  if (options.secure) parts.push("Secure");
  return parts.join("; ");
}

function clearSessionCookie(options = {}) {
  const parts = [`${COOKIE_NAME}=`, "Path=/", "HttpOnly", "SameSite=Lax", "Max-Age=0"];
  if (options.secure) parts.push("Secure");
  return parts.join("; ");
}

function parseCookies(cookieHeader) {
  const cookies = new Map();
  String(cookieHeader || "")
    .split(";")
    .map((item) => item.trim())
    .filter(Boolean)
    .forEach((item) => {
      const separator = item.indexOf("=");
      if (separator === -1) return;
      cookies.set(item.slice(0, separator), item.slice(separator + 1));
    });
  return cookies;
}

function readSession(cookieHeader, options = {}) {
  const secret = options.secret || sessionSecret();
  const token = parseCookies(cookieHeader).get(COOKIE_NAME);
  if (!secret || !token) return null;

  const [payload, signature] = token.split(".");
  if (!payload || !signature || !safeEqual(signature, signPayload(payload, secret))) return null;

  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (!data.sub || Number(data.exp) <= Number(options.now || Date.now())) return null;
    return {
      username: data.sub,
      role: data.role ? normalizeRole(data.role) : inferSessionRole(data.sub),
    };
  } catch (_error) {
    return null;
  }
}

function verifyPasswordHash(password, passwordHash) {
  const [scheme, salt, expected] = String(passwordHash || "").split(":");
  if (scheme !== "scrypt" || !salt || !expected) return false;
  const actual = crypto.scryptSync(String(password || ""), salt, 32).toString("base64url");
  return safeEqual(actual, expected);
}

function isSecureRequest(req) {
  return String(req.headers?.["x-forwarded-proto"] || "").split(",")[0].trim() === "https";
}

function isProtectedBackendPath(pathname) {
  return /\/api\/(?:workflows|jobs|source-requests|wechat-drafts)(?:\/|$)/.test(String(pathname || ""));
}

function writeJson(res, statusCode, payload, headers = {}) {
  res.statusCode = statusCode;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("cache-control", "no-store");
  for (const [name, value] of Object.entries(headers)) {
    res.setHeader(name, value);
  }
  res.end(JSON.stringify(payload));
}

async function readJsonBody(req) {
  if (req.body && typeof req.body === "object" && !Buffer.isBuffer(req.body)) return req.body;
  if (typeof req.body === "string") return req.body.trim() ? JSON.parse(req.body) : {};
  if (Buffer.isBuffer(req.body)) {
    const raw = req.body.toString("utf8").trim();
    return raw ? JSON.parse(raw) : {};
  }
  const chunks = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  return raw ? JSON.parse(raw) : {};
}

module.exports = {
  COOKIE_NAME,
  PROXY_SECRET_HEADER,
  clearSessionCookie,
  createSessionCookie,
  isProtectedBackendPath,
  isSecureRequest,
  normalizeRole,
  readJsonBody,
  readSession,
  verifyPasswordHash,
  writeJson,
};
