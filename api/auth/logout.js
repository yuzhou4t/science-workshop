const { clearSessionCookie, isSecureRequest, writeJson } = require("../workshop-auth.js");

module.exports = function logout(req, res) {
  if (req.method !== "POST") {
    res.setHeader("allow", "POST");
    writeJson(res, 405, { detail: "Method not allowed" });
    return;
  }

  writeJson(
    res,
    200,
    { ok: true },
    { "set-cookie": clearSessionCookie({ secure: isSecureRequest(req) }) },
  );
};
