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

// ---------- Adexium auto-sync (real Stats API — fully automatic for this network) ----------
// POST /api/admin/tasks/:id/sync-adexium?days=1 — pulls yesterday's (or last
// N days') real revenue/impressions from Adexium's own API and smoothly
// nudges adminRevenuePerAction toward the real observed rate.
router.post("/tasks/:id/sync-adexium", async (req, res) => {
  const { getTaskAdexiumTotals } = require("../lib/adexiumApi");
  const days = Math.max(1, Number(req.query.days) || 1);

  const task = await prisma.adTask.findUnique({ where: { id: req.params.id } });
  if (!task) return res.status(404).json({ error: "Không tìm thấy nhiệm vụ" });
  if (task.network !== "ADEXIUM") return res.status(400).json({ error: "Chỉ dùng được cho nhiệm vụ Adexium" });

  const widgetIds = (Array.isArray(task.zoneIds) ? task.zoneIds : [])
    .map(e => (typeof e === "string" ? e : e.statsId))
    .filter(Boolean);
  if (widgetIds.length === 0) return res.status(400).json({ error: "Nhiệm vụ chưa có Stats ID nào (khác với WID) — vào Sửa nhiệm vụ điền thêm" });
  if (!process.env.ADEXIUM_API_TOKEN) return res.status(400).json({ error: "Chưa cấu hình ADEXIUM_API_TOKEN trong biến môi trường" });

  const end = new Date();
  const start = new Date(); start.setDate(start.getDate() - days);
  const fmtDate = (d) => d.toISOString().slice(0, 10);

  try {
    const { totalRevenueUsd, totalImpressions } = await getTaskAdexiumTotals(widgetIds, fmtDate(start), fmtDate(end));
    if (totalImpressions === 0) {
      return res.json({ ok: true, note: "Chưa có impression nào trong khoảng thời gian này, giữ nguyên rate cũ", oldRate: task.adminRevenuePerAction });
    }

    const config = await prisma.adminConfig.upsert({ where: { id: 1 }, update: {}, create: { id: 1 } });
    const realRatePerViewVnd = (totalRevenueUsd / totalImpressions) * (config.usdToVndRate || 26300);

    const EMA_ALPHA = 0.4; // smooth toward real number, don't jump on one unusual day
    const newRate = Math.round(task.adminRevenuePerAction * (1 - EMA_ALPHA) + realRatePerViewVnd * EMA_ALPHA);

    await prisma.adTask.update({ where: { id: task.id }, data: { adminRevenuePerAction: newRate } });

    res.json({
      ok: true,
      oldRate: task.adminRevenuePerAction,
      newRate,
      realRatePerViewVnd: Math.round(realRatePerViewVnd),
      totalRevenueUsd,
      totalImpressions,
      dateRange: `${fmtDate(start)} → ${fmtDate(end)}`,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---------- Reconciliation: compare real network revenue vs what was paid out ----------
// GET /api/admin/reconciliation?taskId=X&date=YYYY-MM-DD
// Read-only aggregation — admin then manually enters the REAL revenue figure
// from the network's own dashboard on the frontend to compute profit/loss.
router.get("/reconciliation", async (req, res) => {
  const { taskId, date } = req.query;
  if (!taskId || !date) return res.status(400).json({ error: "Thiếu taskId hoặc date" });

  const dayStart = new Date(date); dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(dayStart); dayEnd.setDate(dayEnd.getDate() + 1);

  const [task, agg] = await Promise.all([
    prisma.adTask.findUnique({ where: { id: taskId } }),
    prisma.taskCompletion.aggregate({
      where: { taskId, createdAt: { gte: dayStart, lt: dayEnd } },
      _sum: { userReward: true },
      _count: true,
    }),
  ]);
  if (!task) return res.status(404).json({ error: "Không tìm thấy nhiệm vụ" });

  res.json({
    task: { id: task.id, title: task.title, network: task.network, currentRate: task.adminRevenuePerAction },
    viewCount: agg._count || 0,
    totalUserPaid: agg._sum.userReward || 0,
  });
});

// POST /api/admin/reconciliation/apply — auto-adjust using exponential moving
// average (smooths toward the real number over several days instead of a
// hard jump, so one unusually good/bad day doesn't overcorrect the rate).
router.post("/reconciliation/apply", async (req, res) => {
  const { taskId, actualRevenue, viewCount, alpha } = req.body;
  if (!taskId || actualRevenue == null || !viewCount) return res.status(400).json({ error: "Thiếu dữ liệu" });

  const task = await prisma.adTask.findUnique({ where: { id: taskId } });
  if (!task) return res.status(404).json({ error: "Không tìm thấy nhiệm vụ" });

  const realRatePerView = actualRevenue / viewCount;
  const smoothing = Math.min(Math.max(Number(alpha) || 0.4, 0.05), 1); // clamp 0.05–1
  const newRate = Math.round(task.adminRevenuePerAction * (1 - smoothing) + realRatePerView * smoothing);

  await prisma.adTask.update({ where: { id: taskId }, data: { adminRevenuePerAction: newRate } });
  res.json({ ok: true, oldRate: task.adminRevenuePerAction, realRatePerView: Math.round(realRatePerView), newRate });
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
