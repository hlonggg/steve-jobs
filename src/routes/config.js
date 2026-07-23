const express = require("express");
const prisma = require("../lib/prisma");
const router = express.Router();

// GET /api/config — safe subset of AdminConfig for the mini app UI.
// Requires a verified Telegram session but is not admin-only; these fields
// aren't sensitive (users can already infer their own share % from
// /api/tasks previewReward anyway).
router.get("/", async (req, res) => {
  const config = await prisma.adminConfig.upsert({ where: { id: 1 }, update: {}, create: { id: 1 } });
  res.json({
    vipPrices: config.vipPrices || {},
    vipRevenueBoost: config.vipRevenueBoost || {},
    interstitialEveryNClicks: config.interstitialEveryNClicks || 0,
    minWithdraw: config.minWithdraw,
    withdrawFeePercent: config.withdrawFeePercent,
  });
});

module.exports = router;

