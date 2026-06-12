const { readSession, writeJson } = require("../workshop-auth.js");

module.exports = function me(req, res) {
  if (req.method !== "GET") {
    res.setHeader("allow", "GET");
    writeJson(res, 405, { detail: "Method not allowed" });
    return;
  }

  const session = readSession(req.headers.cookie || "");
  writeJson(res, 200, session ? { authenticated: true, user: session } : { authenticated: false });
};
