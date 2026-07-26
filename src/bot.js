const { Telegraf, Markup } = require("telegraf");
const prisma = require("./lib/prisma");

const bot = new Telegraf(process.env.BOT_TOKEN);
const APP_URL = process.env.MINI_APP_URL; // e.g. https://coinvault.up.railway.app

bot.start(async (ctx) => {
  const refCode = ctx.startPayload; // /start <refCode>
  const name = ctx.from.first_name || "bạn";

  await ctx.reply(
    `👋 Chào ${name}!\n\n💰 *CoinVault* — xem quảng cáo, nhận tiền thật.\n` +
      `Mỗi lượt xem video = tiền mặt vào ví ngay lập tức.\n\n` +
      `Nhấn nút bên dưới để bắt đầu kiếm tiền 👇`,
    {
      parse_mode: "Markdown",
      ...Markup.inlineKeyboard([
        Markup.button.webApp("🚀 Mở CoinVault", refCode ? `${APP_URL}?ref=${refCode}` : APP_URL),
      ]),
    }
  );
});

bot.command("wallet", async (ctx) => {
  const user = await prisma.user.findUnique({ where: { telegramId: String(ctx.from.id) } });
  if (!user) return ctx.reply("Bạn chưa có tài khoản, gõ /start trước nhé.");
  await ctx.reply(`💰 Số dư hiện tại: ${user.balance.toLocaleString("vi-VN")}đ`);
});

bot.command("invite", async (ctx) => {
  const user = await prisma.user.findUnique({ where: { telegramId: String(ctx.from.id) } });
  if (!user) return ctx.reply("Bạn chưa có tài khoản, gõ /start trước nhé.");
  const botInfo = await ctx.telegram.getMe();
  const link = `https://t.me/${botInfo.username}?start=${user.referralCode}`;
  await ctx.reply(
    `👥 Link giới thiệu của bạn:\n${link}\n\n` +
      `Mời bạn bè, nhận hoa hồng 3 tầng trên mọi khoản họ kiếm được!`
  );
});

// Admin entry point — MUST be opened this way, not via a plain browser URL.
// admin.html calls backend APIs that require real Telegram `initData` for
// auth (see telegramAuthMiddleware + ADMIN_TELEGRAM_IDS check in admin.js);
// opening it outside Telegram has no initData and every request 401s.
// Only visible/usable to Telegram IDs listed in ADMIN_TELEGRAM_IDS.
bot.command("admin", async (ctx) => {
  const allowlist = (process.env.ADMIN_TELEGRAM_IDS || "").split(",").map(s => s.trim());
  if (!allowlist.includes(String(ctx.from.id))) return; // silently ignore for non-admins
  await ctx.reply(
    "🛠 Trang quản trị CoinVault",
    Markup.inlineKeyboard([
      Markup.button.webApp("Mở Admin Panel", `${APP_URL}/admin.html`),
    ])
  );
});

// CRITICAL: without a global error handler, ANY exception thrown inside a
// bot handler (e.g. trying to message a user who blocked the bot — a 403
// Telegram error, which happens constantly in normal use) crashes the
// ENTIRE Node process, taking down the whole app (API + mini app + admin
// panel) for every user, not just the one who blocked it. This catches
// every such error and just logs it instead.
bot.catch((err, ctx) => {
  console.error(`Bot error for update ${ctx.updateType}:`, err.message);
});

module.exports = bot;
