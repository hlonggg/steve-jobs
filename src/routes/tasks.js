const express = require("express");
const prisma = require("../lib/prisma");
const { checkTaskEligibility, getNextZoneId, getNextDirectLink } = require("../middleware/rateLimiter");
const { splitTaskReward, computeReferralChain } = require("../lib/economics");
const router = express.Router();

// GET /api/tasks — list active tasks visible to this user's VIP tier
router.get("/", async (req, res) => {
  const telegramId = String(req.tgUser.id);
  const user = await prisma.user.findUnique({ where: { telegramId } });
  if (!user) return res.status(404).json({ error: "User not found" });

  const tasks = await prisma.adTask.findMany({
    where: { active: true, minVipTier: { lte: user.vipTier } },
    orderBy: { sortOrder: "asc" },
  });

  // attach per-task "reward per view" preview + next rotating ad zone so UI can show it honestly
  const config = await prisma.adminConfig.findUnique({ where: { id: 1 } });
  const withPreview = await Promise.all(tasks.map(async (t) => {
    const { userReward } = splitTaskReward({
      task: t, user, adminConfig: config, sourceRevenue: t.adminRevenuePerAction,
    });
    const nextZoneId = t.adTrigger === "REWARDED_CALLBACK" ? await getNextZoneId(user.id, t) : null;
    const nextDirectLink = t.adTrigger === "DIRECT_LINK" ? await getNextDirectLink(user.id, t) : null;
    return { ...t, previewReward: userReward, nextZoneId, nextDirectLink };
  }));

  res.json({ tasks: withPreview, energy: user.energy });
});

// POST /api/tasks/:id/direct-link/start
// Called right before opening a DIRECT_LINK task's URL (Adsterra Direct Link
// etc). Logs the start time so /complete can verify a minimum dwell period —
// these networks give no real "watched" callback, so this timer is the only
// fraud-resistance available. Old pending clicks for the same task are
// cleared first so a user can't stack multiple opens to shortcut the timer.
router.post("/:id/direct-link/start", async (req, res) => {
  const telegramId = String(req.tgUser.id);
  const { id } = req.params;
  const [user, task] = await Promise.all([
    prisma.user.findUnique({ where: { telegramId } }),
    prisma.adTask.findUnique({ where: { id } }),
  ]);
  if (!user || !task || task.adTrigger !== "DIRECT_LINK") return res.status(404).json({ error: "Nhiệm vụ không hợp lệ" });

  const url = await getNextDirectLink(user.id, task);
  if (!url) return res.status(400).json({ error: "Nhiệm vụ chưa cấu hình link" });

  await prisma.pendingLinkClick.deleteMany({ where: { userId: user.id, taskId: task.id } });
  await prisma.pendingLinkClick.create({ data: { userId: user.id, taskId: task.id, url } });

  res.json({ ok: true, url, dwellSeconds: task.dwellSeconds });
});

// POST /api/tasks/:id/complete
// Called by the client AFTER the ad SDK confirms the view/click was genuinely
// watched/completed (onReward callback from Monetag/Adexium/Adsgram SDK), OR
// — for DIRECT_LINK tasks — after the dwell timer has elapsed since /start.
// sourceRevenueOverride is optional — only trusted if postback verification is
// wired up server-side (see README "verifying ad postbacks").
router.post("/:id/complete", async (req, res) => {
  const telegramId = String(req.tgUser.id);
  const { id } = req.params;

  const [user, task, config] = await Promise.all([
    prisma.user.findUnique({ where: { telegramId } }),
    prisma.adTask.findUnique({ where: { id } }),
    prisma.adminConfig.findUnique({ where: { id: 1 } }),
  ]);
  if (!user || !task || !task.active) return res.status(404).json({ error: "Nhiệm vụ không tồn tại" });
  if (user.banned) return res.status(403).json({ error: "Tài khoản bị khóa" });

  const eligibility = await checkTaskEligibility(user.id, task);
  if (!eligibility.ok) return res.status(429).json({ error: eligibility.reason });

  if (task.adTrigger === "DIRECT_LINK") {
    const pending = await prisma.pendingLinkClick.findFirst({
      where: { userId: user.id, taskId: task.id }, orderBy: { startedAt: "desc" },
    });
    if (!pending) return res.status(400).json({ error: "Bạn chưa mở link nhiệm vụ" });
    const elapsed = (Date.now() - pending.startedAt.getTime()) / 1000;
    if (elapsed < task.dwellSeconds) {
      return res.status(429).json({ error: `Chờ thêm ${Math.ceil(task.dwellSeconds - elapsed)}s rồi bấm lại` });
    }
    await prisma.pendingLinkClick.delete({ where: { id: pending.id } }); // one-time use, prevents replay
  }

  // sourceRevenue = what the network actually paid admin. Always trust the
  // admin-configured rate, never a client-supplied number (anti-fraud).
  const sourceRevenue = task.adminRevenuePerAction;
  const { userReward, adminProfit, sharePercent } = splitTaskReward({
    task, user, adminConfig: config, sourceRevenue,
  });

  const expGain = Math.max(1, Math.round(userReward / 10));
  // Recomputed server-side (not trusted from client) so rotation stats stay accurate.
  const zoneId = await getNextZoneId(user.id, task);

  const [completion] = await prisma.$transaction([
    prisma.taskCompletion.create({
      data: {
        userId: user.id, taskId: task.id,
        sourceRevenue, userReward, adminProfit, zoneId,
        ip: req.ip, device: req.headers["user-agent"],
      },
    }),
    prisma.user.update({
      where: { id: user.id },
      data: {
        balance: { increment: userReward },
        totalEarned: { increment: userReward },
        exp: { increment: expGain },
        energy: { increment: task.type === "REWARDED_VIDEO" ? 2 : 0 },
      },
    }),
  ]);

  // referral commissions — paid from admin's own margin, up to 3 tiers
  await payReferralChain(user, userReward, config);

  res.json({ ok: true, userReward, sharePercent, completionId: completion.id });
});

async function payReferralChain(user, userReward, config) {
  const chain = computeReferralChain({ referredUser: user, userReward, adminConfig: config });
  let current = user;
  for (const tier of chain) {
    if (!current.referredById) break;
    const referrer = await prisma.user.findUnique({ where: { id: current.referredById } });
    if (!referrer || referrer.banned) break;
    if (tier.amount > 0) {
      await prisma.$transaction([
        prisma.referralEarning.create({
          data: {
            earnerId: referrer.id, fromUserId: user.id,
            tier: tier.level, commissionPercent: tier.percent, amount: tier.amount,
          },
        }),
        prisma.user.update({ where: { id: referrer.id }, data: { balance: { increment: tier.amount }, totalEarned: { increment: tier.amount } } }),
      ]);
    }
    current = referrer;
  }
}

// POST /api/tasks/checkin — daily streak bonus (fixed, no ad math)
router.post("/checkin/claim", async (req, res) => {
  const telegramId = String(req.tgUser.id);
  const user = await prisma.user.findUnique({ where: { telegramId } });
  if (!user) return res.status(404).json({ error: "User not found" });

  const now = new Date();
  if (user.lastCheckIn) {
    const hoursSince = (now - user.lastCheckIn) / 36e5;
    if (hoursSince < 20) return res.status(429).json({ error: "Đã điểm danh hôm nay" });
  }
  const hoursSince = user.lastCheckIn ? (now - user.lastCheckIn) / 36e5 : 999;
  const newStreak = hoursSince <= 48 ? user.streak + 1 : 1;
  const reward = Math.min(500 + newStreak * 100, 3000); // fixed VND, admin-funded acquisition cost

  await prisma.user.update({
    where: { id: user.id },
    data: { streak: newStreak, lastCheckIn: now, balance: { increment: reward }, totalEarned: { increment: reward } },
  });

  res.json({ ok: true, streak: newStreak, reward });
});

module.exports = router;
