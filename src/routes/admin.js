const express = require("express");
const prisma = require("../lib/prisma");
const router = express.Router();

// Only Telegram IDs listed in ADMIN_TELEGRAM_IDS (comma-separated) may pass.
function requireAdmin(req, res, next) {
  const allowlist = (process.env.ADMIN_TELEGRAM_IDS || "").split(",").map(s => s.trim());
  if (!allowlist.includes(String(req.tgUser.id))) {
    return res.status(403).json({ error: "Không có quyền truy cập admin" });
  }
  next();
}
router.use(requireAdmin);

// ---------- Profit dashboard ----------
router.get("/overview", async (req, res) => {
  const [revenueAgg, userCount, pendingWithdrawals, todayAgg] = await Promise.all([
    prisma.taskCompletion.aggregate({ _sum: { sourceRevenue: true, userReward: true, adminProfit: true } }),
    prisma.user.count(),
    prisma.withdrawal.count({ where: { status: "PENDING" } }),
    prisma.taskCompletion.aggregate({
      where: { createdAt: { gte: new Date(new Date().setHours(0, 0, 0, 0)) } },
      _sum: { adminProfit: true, userReward: true },
      _count: true,
    }),
  ]);
  res.json({
    totalSourceRevenue: revenueAgg._sum.sourceRevenue || 0,
    totalUserPaid: revenueAgg._sum.userReward || 0,
    totalAdminProfit: revenueAgg._sum.adminProfit || 0,
    userCount,
    pendingWithdrawals,
    todayProfit: todayAgg._sum.adminProfit || 0,
    todayUserPaid: todayAgg._sum.userReward || 0,
    todayViews: todayAgg._count || 0,
  });
});

// ---------- Task / network CPM management ----------
router.get("/tasks", async (req, res) => {
  const tasks = await prisma.adTask.findMany({ orderBy: { sortOrder: "asc" } });
  res.json({ tasks });
});

router.post("/tasks", async (req, res) => {
  const task = await prisma.adTask.create({ data: req.body });
  res.json({ task });
});

router.patch("/tasks/:id", async (req, res) => {
  const task = await prisma.adTask.update({ where: { id: req.params.id }, data: req.body });
  res.json({ task });
});

router.delete("/tasks/:id", async (req, res) => {
  await prisma.adTask.delete({ where: { id: req.params.id } });
  res.json({ ok: true });
});

// ---------- Global config (revenue share %, fees, VIP prices) ----------
router.get("/config", async (req, res) => {
  const config = await prisma.adminConfig.upsert({ where: { id: 1 }, update: {}, create: { id: 1 } });
  res.json({ config });
});

router.patch("/config", async (req, res) => {
  const config = await prisma.adminConfig.update({ where: { id: 1 }, data: req.body });
  res.json({ config });
});

// ---------- Withdrawals ----------
router.get("/withdrawals", async (req, res) => {
  const status = req.query.status;
  const withdrawals = await prisma.withdrawal.findMany({
    where: status ? { status } : undefined,
    orderBy: { createdAt: "desc" },
    include: { user: { select: { username: true, telegramId: true } } },
  });
  res.json({ withdrawals });
});

router.patch("/withdrawals/:id", async (req, res) => {
  const { status, adminNote } = req.body;
  const withdrawal = await prisma.withdrawal.findUnique({ where: { id: req.params.id } });
  if (!withdrawal) return res.status(404).json({ error: "Not found" });

  // if rejecting, refund the user's balance
  if (status === "REJECTED" && withdrawal.status !== "REJECTED") {
    await prisma.user.update({ where: { id: withdrawal.userId }, data: { balance: { increment: withdrawal.amountRequested } } });
  }

  const updated = await prisma.withdrawal.update({
    where: { id: req.params.id },
    data: { status, adminNote, processedAt: new Date() },
  });
  res.json({ withdrawal: updated });
});

// ---------- Ad Slots (raw-script embeds — Adsterra, PropellerAds, etc) ----------
router.get("/adslots", async (req, res) => {
  const slots = await prisma.adSlot.findMany({ orderBy: { sortOrder: "asc" } });
  res.json({ slots });
});

router.post("/adslots", async (req, res) => {
  const slot = await prisma.adSlot.create({ data: req.body });
  res.json({ slot });
});

router.patch("/adslots/:id", async (req, res) => {
  const slot = await prisma.adSlot.update({ where: { id: req.params.id }, data: req.body });
  res.json({ slot });
});

router.delete("/adslots/:id", async (req, res) => {
  await prisma.adSlot.delete({ where: { id: req.params.id } });
  res.json({ ok: true });
});

// ---------- Users ----------
router.get("/users", async (req, res) => {
  const q = req.query.q;
  const users = await prisma.user.findMany({
    where: q ? { OR: [{ username: { contains: q } }, { telegramId: { contains: q } }] } : undefined,
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  res.json({ users });
});

router.patch("/users/:id/ban", async (req, res) => {
  const { banned, banReason } = req.body;
  const user = await prisma.user.update({ where: { id: req.params.id }, data: { banned, banReason } });
  res.json({ user });
});

module.exports = router;
