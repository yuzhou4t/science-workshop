const { Readable } = require("node:stream");
const {
  PROXY_SECRET_HEADER,
  isProtectedBackendPath,
  readSession,
  writeJson,
} = require("./workshop-auth.js");

const BACKEND_ORIGIN = process.env.SCIENCE_WORKSHOP_BACKEND_ORIGIN || "http://106.53.153.215";
const BACKEND_PREFIX = process.env.SCIENCE_WORKSHOP_BACKEND_PREFIX || "/science-workshop-api";
const WORKSHOP_USER_HEADER = "x-workshop-user";
const WORKSHOP_ROLE_HEADER = "x-workshop-role";
const HOP_BY_HOP_HEADERS = new Set([
  "connection",
  "content-encoding",
  "content-length",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

function backendPathFromRequest(req) {
  const parsed = new URL(req.url || "/", "http://localhost");
  let path = parsed.searchParams.get("path") || "";
  parsed.searchParams.delete("path");

  if (!path) {
    path = parsed.pathname
      .replace(/^\/api\/science-workshop-proxy\/?/, "")
      .replace(/^\/science-workshop-api\/?/, "");
  }

  path = path.replace(/^\/+/, "");
  const query = parsed.searchParams.toString();
  return `${BACKEND_PREFIX}/${path}${query ? `?${query}` : ""}`;
}

function requestHeaders(req) {
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers || {})) {
    const lower = name.toLowerCase();
    if (
      HOP_BY_HOP_HEADERS.has(lower)
      || lower === "host"
      || lower === PROXY_SECRET_HEADER
      || lower === WORKSHOP_USER_HEADER
      || lower === WORKSHOP_ROLE_HEADER
    ) continue;
    if (Array.isArray(value)) {
      for (const item of value) headers.append(name, item);
    } else if (value != null) {
      headers.set(name, String(value));
    }
  }
  headers.set("accept-encoding", "identity");
  return headers;
}

function requestBody(req) {
  if (req.method === "GET" || req.method === "HEAD") return undefined;
  if (req.readable && !req.readableEnded) return req;
  if (req.body == null) return undefined;
  if (Buffer.isBuffer(req.body) || typeof req.body === "string") return req.body;
  return JSON.stringify(req.body);
}

function copyResponseHeaders(upstream, res) {
  upstream.headers.forEach((value, name) => {
    const lower = name.toLowerCase();
    if (HOP_BY_HOP_HEADERS.has(lower)) return;
    res.setHeader(name, value);
  });
}

module.exports = async function scienceWorkshopProxy(req, res) {
  const target = new URL(backendPathFromRequest(req), BACKEND_ORIGIN);
  const body = requestBody(req);
  const protectedRoute = isProtectedBackendPath(target.pathname);
  const session = readSession(req.headers.cookie || "");

  if (protectedRoute && !session) {
    writeJson(res, 401, { detail: "Unauthorized" });
    return;
  }

  const headers = requestHeaders(req);
  if (protectedRoute && session?.username) {
    headers.set(WORKSHOP_USER_HEADER, session.username);
    headers.set(WORKSHOP_ROLE_HEADER, session.role || "user");
  }
  if (process.env.SCIENCE_WORKSHOP_PROXY_SECRET) {
    headers.set(PROXY_SECRET_HEADER, process.env.SCIENCE_WORKSHOP_PROXY_SECRET);
  }

  try {
    const upstream = await fetch(target, {
      method: req.method,
      headers,
      body,
      ...(body ? { duplex: "half" } : {}),
      redirect: "manual",
    });

    res.statusCode = upstream.status;
    res.statusMessage = upstream.statusText;
    copyResponseHeaders(upstream, res);

    if (!upstream.body) {
      res.end();
      return;
    }

    Readable.fromWeb(upstream.body).pipe(res);
  } catch (error) {
    console.error("Science Workshop proxy failed", error);
    res.statusCode = 502;
    res.setHeader("content-type", "application/json; charset=utf-8");
    res.end(JSON.stringify({ detail: "Science Workshop backend proxy failed" }));
  }
};
