const express = require("express");
const prisma = require("../lib/prisma");
const router = express.Router();

router.get("/", async (req, res) => {
  const telegramId = String(req.tgUser.id);
  const user = await prisma.user.findUnique({ where: { telegramId } });
  if (!user) return res.status(404).json({ error: "User not found" });

  const since = new Date();
  since.setHours(0, 0, 0, 0);

  const [todayAgg, referralCount, referralEarnedAgg, recentCompletions, config] = await Promise.all([
    prisma.taskCompletion.aggregate({
      where: { userId: user.id, createdAt: { gte: since } },
      _sum: { userReward: true },
      _count: true,
    }),
    prisma.user.count({ where: { referredById: user.id } }),
    prisma.referralEarning.aggregate({
      where: { earnerId: user.id },
      _sum: { amount: true },
    }),
    prisma.taskCompletion.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      take: 5,
      include: { task: { select: { title: true, type: true } } },
    }),
    prisma.adminConfig.findUnique({ where: { id: 1 } }),
  ]);

  res.json({
    balance: user.balance,
    totalEarned: user.totalEarned,
    level: user.level,
    exp: user.exp,
    vipTier: user.vipTier,
    energy: user.energy,
    streak: user.streak,
    todayEarned: todayAgg._sum.userReward || 0,
    todayViews: todayAgg._count || 0,
    referralCount,
    referralEarned: referralEarnedAgg._sum.amount || 0,
    recentCompletions,
    siteWideAdsEnabled: config?.siteWideAdsEnabled ?? false,
    siteWideAdScripts: config?.siteWideAdsEnabled ? (config.siteWideAdScripts || []) : [],
  });
});

module.exports = router;
