require("dotenv").config();
const express = require("express");
const cors = require("cors");
const path = require("path");
const { telegramAuthMiddleware } = require("./lib/telegramAuth");
const bot = require("./bot");

const authRoutes = require("./routes/auth");
const publicConfigRoutes = require("./routes/publicConfig");
const dashboardRoutes = require("./routes/dashboard");
const taskRoutes = require("./routes/tasks");
const walletRoutes = require("./routes/wallet");
const adminRoutes = require("./routes/admin");
const adslotRoutes = require("./routes/adslots");
const configRoutes = require("./routes/config");
const postbackRoutes = require("./routes/postback");

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

// truly public — no Telegram auth needed, just static config the frontend needs
app.use("/api/public", publicConfigRoutes);
// truly public — called by ad network servers directly, protected by its own secret query param
app.use("/api/postback", postbackRoutes);

// public (route itself still requires a verified Telegram session, just no user record needed yet)
app.use("/api/auth", telegramAuthMiddleware, authRoutes);

// everything below requires a verified Telegram session
app.use("/api/dashboard", telegramAuthMiddleware, dashboardRoutes);
app.use("/api/tasks", telegramAuthMiddleware, taskRoutes);
app.use("/api/wallet", telegramAuthMiddleware, walletRoutes);
app.use("/api/admin", telegramAuthMiddleware, adminRoutes);
app.use("/api/adslots", telegramAuthMiddleware, adslotRoutes);
app.use("/api/config", telegramAuthMiddleware, configRoutes);

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

// ---------- Daily Adexium auto-sync ----------
// Fully automatic rate correction using Adexium's real Stats API — no admin
// action needed once ADEXIUM_API_TOKEN is set. Runs once shortly after boot,
// then every 24h. Monetag/Adsterra don't offer a public stats API, so those
// still rely on the manual/postback tools in the admin panel.
async function syncAllAdexiumTasks() {
  if (!process.env.ADEXIUM_API_TOKEN) return; // skip silently if not configured
  const prisma = require("./lib/prisma");
  const { getTaskAdexiumTotals } = require("./lib/adexiumApi");
  try {
    const tasks = await prisma.adTask.findMany({ where: { network: "ADEXIUM", active: true } });
    const config = await prisma.adminConfig.upsert({ where: { id: 1 }, update: {}, create: { id: 1 } });
    const end = new Date();
    const start = new Date(); start.setDate(start.getDate() - 1);
    const fmtDate = (d) => d.toISOString().slice(0, 10);

    for (const task of tasks) {
      const widgetIds = (Array.isArray(task.zoneIds) ? task.zoneIds : [])
        .map(e => (typeof e === "string" ? e : e.statsId))
        .filter(Boolean);
      if (widgetIds.length === 0) continue;
      try {
        const { totalRevenueUsd, totalImpressions } = await getTaskAdexiumTotals(widgetIds, fmtDate(start), fmtDate(end));
        if (totalImpressions === 0) continue;
        const realRatePerViewVnd = (totalRevenueUsd / totalImpressions) * (config.usdToVndRate || 26300);
        const newRate = Math.round(task.adminRevenuePerAction * 0.6 + realRatePerViewVnd * 0.4);
        await prisma.adTask.update({ where: { id: task.id }, data: { adminRevenuePerAction: newRate } });
        console.log(`[adexium-sync] "${task.title}": ${task.adminRevenuePerAction}đ → ${newRate}đ/view`);
      } catch (e) {
        console.warn(`[adexium-sync] failed for task ${task.id}:`, e.message);
      }
    }
  } catch (e) {
    console.warn("[adexium-sync] run failed:", e.message);
  }
}
setTimeout(syncAllAdexiumTasks, 60 * 1000); // once shortly after boot
setInterval(syncAllAdexiumTasks, 24 * 60 * 60 * 1000); // then every 24h
