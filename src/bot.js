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

bot.launch();
console.log("Telegram bot started");

process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));

module.exports = bot;
