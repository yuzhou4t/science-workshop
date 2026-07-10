const { Readable } = require("node:stream");
const {
  PROXY_SECRET_HEADER,
  isProtectedBackendPath,
  readSession,
  writeJson,
} = require("./workshop-auth.js");

const BACKEND_ORIGIN = process.env.SCIENCE_WORKSHOP_BACKEND_ORIGIN || "http://106.53.153.215";
const BACKEND_PREFIX = process.env.SCIENCE_WORKSHOP_BACKEND_PREFIX ?? "/science-workshop-api";
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

function canonicalizeBackendPath(path) {
  let decoded = String(path || "");
  for (let index = 0; index < 8 && /%[0-9a-f]{2}/i.test(decoded); index += 1) {
    try {
      decoded = decodeURIComponent(decoded);
    } catch (_error) {
      throw new Error("Invalid backend path");
    }
  }
  if (/%[0-9a-f]{2}/i.test(decoded) || /[\\\u0000-\u001f\u007f]/.test(decoded)) {
    throw new Error("Invalid backend path");
  }
  return decoded.replace(/^\/+/, "");
}

function encodeBackendPath(path) {
  return String(path || "")
    .replace(/^\/+/, "")
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

function backendTargetFromRequest(req) {
  const parsed = new URL(req.url || "/", "http://localhost");
  const pathParameter = parsed.searchParams.get("path");
  let path = pathParameter || "";
  parsed.searchParams.delete("path");

  if (!path) {
    path = parsed.pathname
      .replace(/^\/api\/science-workshop-proxy\/?/, "")
      .replace(/^\/science-workshop-api\/?/, "");
    try {
      path = decodeURIComponent(path);
    } catch (_error) {
      throw new Error("Invalid backend path");
    }
  }

  if (/[\\\u0000-\u001f\u007f]/.test(path)) throw new Error("Invalid backend path");
  const canonicalPath = canonicalizeBackendPath(path);
  const query = parsed.searchParams.toString();
  const prefix = String(BACKEND_PREFIX).replace(/\/+$/, "");
  const target = new URL(`${prefix}/${encodeBackendPath(path)}`, BACKEND_ORIGIN);
  const authorizationTarget = new URL(`${prefix}/${encodeBackendPath(canonicalPath)}`, BACKEND_ORIGIN);
  target.search = query ? `?${query}` : "";
  return {
    authorizationPath: decodeURIComponent(authorizationTarget.pathname),
    target,
  };
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
  let target;
  let authorizationPath;
  try {
    ({ authorizationPath, target } = backendTargetFromRequest(req));
  } catch (_error) {
    writeJson(res, 400, { detail: "Invalid backend path" });
    return;
  }
  const body = requestBody(req);
  const protectedRoute = isProtectedBackendPath(authorizationPath);
  const session = readSession(req.headers.cookie || "");

  if (protectedRoute && !session) {
    writeJson(res, 401, { detail: "Unauthorized" });
    return;
  }

  const headers = requestHeaders(req);
  if (protectedRoute && session?.username) {
    headers.set(WORKSHOP_USER_HEADER, session.username);
    headers.set(WORKSHOP_ROLE_HEADER, session.role || "user");
    if (process.env.SCIENCE_WORKSHOP_PROXY_SECRET) {
      headers.set(PROXY_SECRET_HEADER, process.env.SCIENCE_WORKSHOP_PROXY_SECRET);
    }
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
