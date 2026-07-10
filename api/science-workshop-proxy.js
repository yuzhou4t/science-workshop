const { Readable } = require("node:stream");
const {
  PROXY_SECRET_HEADER,
  isProtectedBackendPath,
  readSession,
  writeJson,
} = require("./workshop-auth.js");

// Keep the local developer experience convenient while making production
// configuration explicit.  A public HTTP origin is intentionally rejected:
// paper/workflow requests contain credentials and must travel over HTTPS.
const DEFAULT_LOCAL_BACKEND_ORIGIN = "http://127.0.0.1:8000";
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

function configuredBackendOrigin() {
  const configured = String(process.env.SCIENCE_WORKSHOP_BACKEND_ORIGIN || "").trim();
  if (!configured && isProductionRuntime()) {
    throw new Error("SCIENCE_WORKSHOP_BACKEND_ORIGIN must be explicitly configured in production");
  }
  return configured || DEFAULT_LOCAL_BACKEND_ORIGIN;
}

function isProductionRuntime() {
  return String(process.env.NODE_ENV || "").toLowerCase() === "production" || process.env.VERCEL === "1";
}

function isLoopbackHostname(hostname) {
  const normalized = String(hostname || "").toLowerCase().replace(/^\[|\]$/g, "");
  return normalized === "localhost" || normalized === "127.0.0.1" || normalized === "::1";
}

function validateBackendOrigin() {
  const raw = configuredBackendOrigin();
  let origin;
  try {
    origin = new URL(raw);
  } catch (_error) {
    throw new Error("SCIENCE_WORKSHOP_BACKEND_ORIGIN must be a valid URL");
  }
  if (!origin.hostname || !["http:", "https:"].includes(origin.protocol)) {
    throw new Error("SCIENCE_WORKSHOP_BACKEND_ORIGIN must use http or https");
  }
  if (origin.username || origin.password || origin.search || origin.hash) {
    throw new Error("SCIENCE_WORKSHOP_BACKEND_ORIGIN must not contain credentials or query parameters");
  }
  if (origin.protocol === "http:" && (isProductionRuntime() || !isLoopbackHostname(origin.hostname))) {
    throw new Error("HTTP backend is allowed only for local loopback development; configure an HTTPS origin");
  }
  return origin;
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
  const backendOrigin = validateBackendOrigin();
  const target = new URL(`${prefix}/${encodeBackendPath(path)}`, backendOrigin);
  const authorizationTarget = new URL(`${prefix}/${encodeBackendPath(canonicalPath)}`, backendOrigin);
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
  } catch (error) {
    if (/SCIENCE_WORKSHOP_BACKEND_ORIGIN|HTTP backend|HTTPS origin/.test(String(error?.message || ""))) {
      writeJson(res, 503, { detail: "Science Workshop backend must use HTTPS (HTTP is only allowed for local development)" });
      return;
    }
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
