/**
 * ECONOMICS ENGINE
 * ------------------------------------------------------------------
 * Single source of truth for every money split in the app.
 * Rule #1: adminProfit is NEVER negative. Every path is clamped.
 * Rule #2: the user-facing "reward per view" is ALWAYS derived from
 *          what the ad network actually paid admin (task.adminRevenuePerAction),
 *          never a made-up number — so admin margin is structurally guaranteed.
 * ------------------------------------------------------------------
 */

const clamp = (n, min, max) => Math.min(Math.max(n, min), max);

/**
 * Compute effective revenue-share % for a given user + task.
 * VIP tiers get a boosted share (still < 100%, admin always keeps a cut).
 */
function effectiveSharePercent(task, user, adminConfig) {
  const base = task.revenueSharePercent ?? adminConfig.defaultRevenueSharePercent ?? 50;
  const vipBoostMap = adminConfig.vipRevenueBoost || {};
  const boost = user.vipTier > 0 ? Number(vipBoostMap[String(user.vipTier)] || 0) : 0;
  // Hard ceiling: user can NEVER reach 100% — admin margin floor is enforced here.
  const ADMIN_MIN_MARGIN_PERCENT = 8;
  return clamp(base + boost, 0, 100 - ADMIN_MIN_MARGIN_PERCENT);
}

/**
 * Called every time a user completes an ad task (rewarded video, interstitial, etc).
 * `sourceRevenue` = the actual $/VND amount the ad network reports paying admin
 * for this specific view (from network CPM config or realtime postback).
 */
function splitTaskReward({ task, user, adminConfig, sourceRevenue }) {
  const sharePercent = effectiveSharePercent(task, user, adminConfig);
  let userReward = task.fixedReward != null
    ? Math.min(task.fixedReward, sourceRevenue) // fixed rewards still can't exceed source revenue
    : sourceRevenue * (sharePercent / 100);

  userReward = Math.max(0, Math.round(userReward * 100) / 100);
  const adminProfit = Math.max(0, Math.round((sourceRevenue - userReward) * 100) / 100);

  return { userReward, adminProfit, sharePercent };
}

/**
 * Withdrawal fee — admin margin layer #2, independent of task economics.
 */
function splitWithdrawal({ amountRequested, feePercent }) {
  const feeAmount = Math.round(amountRequested * (feePercent / 100) * 100) / 100;
  const amountPaid = Math.round((amountRequested - feeAmount) * 100) / 100;
  return { feeAmount, amountPaid };
}

/**
 * Referral commission — paid OUT of admin's own profit share, not off the top
 * of the user's reward. This means referral payouts never eat into the
 * guaranteed admin margin from splitTaskReward; they're a separate
 * (smaller, capped) admin cost of acquisition.
 */
function computeReferralChain({ referredUser, userReward, adminConfig }) {
  const tiers = [
    { percent: adminConfig.referralTier1Percent, level: 1 },
    { percent: adminConfig.referralTier2Percent, level: 2 },
    { percent: adminConfig.referralTier3Percent, level: 3 },
  ];
  // caller walks up referredUser.referredBy chain up to 3 levels and applies these percents
  return tiers.map(t => ({
    ...t,
    amount: Math.round(userReward * (t.percent / 100) * 100) / 100,
  }));
}

/**
 * Interstitial "click ads" — pure admin revenue, no user split at all.
 * Used for the "every button shows an ad" mechanic. Returns nothing to
 * credit the user; this exists purely to log admin income.
 */
function interstitialRevenue({ sourceRevenue }) {
  return { adminProfit: Math.max(0, sourceRevenue) };
}

module.exports = {
  effectiveSharePercent,
  splitTaskReward,
  splitWithdrawal,
  computeReferralChain,
  interstitialRevenue,
};
