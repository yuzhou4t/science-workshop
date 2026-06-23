const {
  createSessionCookie,
  isSecureRequest,
  normalizeRole,
  readJsonBody,
  verifyPasswordHash,
  writeJson,
} = require("../workshop-auth.js");

function configuredAccounts() {
  const accounts = [];
  const addAccount = (username, passwordHash, role) => {
    if (!username || !passwordHash) return;
    accounts.push({
      username,
      passwordHash,
      role: normalizeRole(role),
    });
  };

  addAccount(process.env.WORKSHOP_ADMIN_USERNAME, process.env.WORKSHOP_ADMIN_PASSWORD_HASH, "admin");
  addAccount(process.env.WORKSHOP_AUTH_USERNAME, process.env.WORKSHOP_AUTH_PASSWORD_HASH, "admin");
  addAccount(process.env.WORKSHOP_USER_USERNAME, process.env.WORKSHOP_USER_PASSWORD_HASH, "user");
  return accounts;
}

module.exports = async function login(req, res) {
  if (req.method !== "POST") {
    res.setHeader("allow", "POST");
    writeJson(res, 405, { detail: "Method not allowed" });
    return;
  }

  const accounts = configuredAccounts();
  if (!accounts.length || !process.env.WORKSHOP_SESSION_SECRET) {
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
  const account = accounts.find((item) => item.username === username);
  if (!account || !verifyPasswordHash(password, account.passwordHash)) {
    writeJson(res, 401, { detail: "Invalid username or password" });
    return;
  }

  writeJson(
    res,
    200,
    { user: { username, role: account.role } },
    { "set-cookie": createSessionCookie(username, { role: account.role, secure: isSecureRequest(req) }) },
  );
};
