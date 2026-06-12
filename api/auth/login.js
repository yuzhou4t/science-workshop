const {
  createSessionCookie,
  isSecureRequest,
  readJsonBody,
  verifyPasswordHash,
  writeJson,
} = require("../workshop-auth.js");

module.exports = async function login(req, res) {
  if (req.method !== "POST") {
    res.setHeader("allow", "POST");
    writeJson(res, 405, { detail: "Method not allowed" });
    return;
  }

  const expectedUsername = process.env.WORKSHOP_AUTH_USERNAME || "";
  const passwordHash = process.env.WORKSHOP_AUTH_PASSWORD_HASH || "";
  if (!expectedUsername || !passwordHash || !process.env.WORKSHOP_SESSION_SECRET) {
    writeJson(res, 503, { detail: "Workshop auth is not configured" });
    return;
  }

  let payload;
  try {
    payload = await readJsonBody(req);
  } catch (_error) {
    writeJson(res, 400, { detail: "Invalid JSON" });
    return;
  }

  const username = String(payload.username || "");
  const password = String(payload.password || "");
  if (username !== expectedUsername || !verifyPasswordHash(password, passwordHash)) {
    writeJson(res, 401, { detail: "Invalid username or password" });
    return;
  }

  writeJson(
    res,
    200,
    { user: { username } },
    { "set-cookie": createSessionCookie(username, { secure: isSecureRequest(req) }) },
  );
};
