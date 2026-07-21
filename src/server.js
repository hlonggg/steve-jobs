require("dotenv").config();
const express = require("express");
const cors = require("cors");
const path = require("path");
const { telegramAuthMiddleware } = require("./lib/telegramAuth");
const bot = require("./bot");

const authRoutes = require("./routes/auth");
const dashboardRoutes = require("./routes/dashboard");
const taskRoutes = require("./routes/tasks");
const walletRoutes = require("./routes/wallet");
const adminRoutes = require("./routes/admin");
const adslotRoutes = require("./routes/adslots");

const app = express();
app.use(cors());

// Telegram webhook needs the raw route mounted before express.json() interferes —
// bot.webhookCallback() parses its own body, so mount it first.
const WEBHOOK_PATH = `/telegraf/${process.env.BOT_TOKEN}`; // token in path = cheap secret, only Telegram knows it
const useWebhook = process.env.NODE_ENV === "production" && !!process.env.MINI_APP_URL;
if (useWebhook) {
  app.use(bot.webhookCallback(WEBHOOK_PATH));
}

app.use(express.json());
app.use(express.static(path.join(__dirname, "..", "public")));

// public (route itself still requires a verified Telegram session, just no user record needed yet)
app.use("/api/auth", telegramAuthMiddleware, authRoutes);

// everything below requires a verified Telegram session
app.use("/api/dashboard", telegramAuthMiddleware, dashboardRoutes);
app.use("/api/tasks", telegramAuthMiddleware, taskRoutes);
app.use("/api/wallet", telegramAuthMiddleware, walletRoutes);
app.use("/api/admin", telegramAuthMiddleware, adminRoutes);
app.use("/api/adslots", telegramAuthMiddleware, adslotRoutes);

app.get("/health", (req, res) => res.json({ ok: true }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
  console.log(`CoinVault API listening on :${PORT}`);

  if (useWebhook) {
    // Webhook mode: Telegram pushes updates to us via HTTP — no long-lived
    // polling connection, so no "only one instance" 409 conflict is possible,
    // even across redeploys/restarts overlapping briefly.
    await bot.telegram.setWebhook(`${process.env.MINI_APP_URL}${WEBHOOK_PATH}`);
    console.log("Telegram bot running in WEBHOOK mode:", WEBHOOK_PATH);
  } else {
    // Local dev fallback: plain long-polling.
    await bot.telegram.deleteWebhook().catch(() => {});
    bot.launch();
    console.log("Telegram bot running in POLLING mode (dev)");
  }
});

process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
