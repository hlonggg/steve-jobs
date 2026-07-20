const crypto = require("crypto");

/**
 * Validates the `initData` string Telegram gives the Mini App on launch.
 * Docs: https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
 */
function verifyInitData(initData, botToken) {
  if (!initData) return null;

  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  params.delete("hash");

  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");

  const secretKey = crypto.createHmac("sha256", "WebAppData").update(botToken).digest();
  const computedHash = crypto.createHmac("sha256", secretKey).update(dataCheckString).digest("hex");

  if (computedHash !== hash) return null;

  const authDate = Number(params.get("auth_date")) * 1000;
  if (Date.now() - authDate > 1000 * 60 * 60 * 24) return null; // reject stale sessions >24h

  const userRaw = params.get("user");
  const user = userRaw ? JSON.parse(userRaw) : null;
  return user ? { user, authDate } : null;
}

/** Express middleware: attaches req.tgUser from the X-Init-Data header */
function telegramAuthMiddleware(req, res, next) {
  const initData = req.headers["x-init-data"];
  const result = verifyInitData(initData, process.env.BOT_TOKEN);
  if (!result) return res.status(401).json({ error: "Invalid or expired Telegram session" });
  req.tgUser = result.user;
  next();
}

module.exports = { verifyInitData, telegramAuthMiddleware };
