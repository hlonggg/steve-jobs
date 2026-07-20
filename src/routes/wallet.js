const express = require("express");
const prisma = require("../lib/prisma");
const { splitWithdrawal } = require("../lib/economics");
const router = express.Router();

router.get("/", async (req, res) => {
  const telegramId = String(req.tgUser.id);
  const user = await prisma.user.findUnique({ where: { telegramId } });
  const withdrawals = await prisma.withdrawal.findMany({
    where: { userId: user.id }, orderBy: { createdAt: "desc" }, take: 20,
  });
  const config = await prisma.adminConfig.findUnique({ where: { id: 1 } });
  res.json({ balance: user.balance, minWithdraw: config.minWithdraw, feePercent: config.withdrawFeePercent, withdrawals });
});

// POST /api/wallet/withdraw { amount, method, destination }
router.post("/withdraw", async (req, res) => {
  const telegramId = String(req.tgUser.id);
  const { amount, method, destination } = req.body || {};

  const user = await prisma.user.findUnique({ where: { telegramId } });
  const config = await prisma.adminConfig.findUnique({ where: { id: 1 } });
  if (!user) return res.status(404).json({ error: "User not found" });

  if (!amount || amount < config.minWithdraw) {
    return res.status(400).json({ error: `Số tiền rút tối thiểu ${config.minWithdraw}đ` });
  }
  if (amount > user.balance) return res.status(400).json({ error: "Số dư không đủ" });
  if (!method || !destination) return res.status(400).json({ error: "Thiếu thông tin nhận tiền" });

  const { feeAmount, amountPaid } = splitWithdrawal({ amountRequested: amount, feePercent: config.withdrawFeePercent });

  const withdrawal = await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: user.id }, data: { balance: { decrement: amount } } });
    return tx.withdrawal.create({
      data: {
        userId: user.id, amountRequested: amount,
        feePercent: config.withdrawFeePercent, feeAmount, amountPaid,
        method, destination, status: "PENDING",
      },
    });
  });

  res.json({ ok: true, withdrawal });
});

// POST /api/wallet/vip/purchase { tier }  — pure admin profit, funded by user's own balance
router.post("/vip/purchase", async (req, res) => {
  const telegramId = String(req.tgUser.id);
  const { tier } = req.body || {};
  const user = await prisma.user.findUnique({ where: { telegramId } });
  const config = await prisma.adminConfig.findUnique({ where: { id: 1 } });

  const prices = config.vipPrices || {};
  const price = Number(prices[String(tier)]);
  if (!price) return res.status(400).json({ error: "Gói VIP không hợp lệ" });
  if (user.balance < price) return res.status(400).json({ error: "Số dư không đủ, hãy nạp hoặc kiếm thêm" });

  await prisma.user.update({
    where: { id: user.id },
    data: { balance: { decrement: price }, vipTier: Number(tier) },
  });

  res.json({ ok: true, vipTier: Number(tier) });
});

module.exports = router;
