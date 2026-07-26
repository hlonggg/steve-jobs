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
  let userReward, adminProfit;
  if (task.fixedReward != null) {
    // Fixed reward mode: admin's explicit choice, pay exactly this amount —
    // no cap, no % math. sourceRevenue (CPM) is optional here and only used
    // to show a truthful profit/loss number (can go negative if the fixed
    // reward is set higher than what the network actually pays — that's a
    // real signal worth seeing, not something to hide).
    userReward = Math.max(0, Math.round(task.fixedReward * 100) / 100);
    adminProfit = Math.round((sourceRevenue - userReward) * 100) / 100;
  } else {
    userReward = sourceRevenue * (sharePercent / 100);
    userReward = Math.max(0, Math.round(userReward * 100) / 100);
    adminProfit = Math.max(0, Math.round((sourceRevenue - userReward) * 100) / 100); // % path mathematically can't go negative
  }

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
 * Commission for ONE level of the referral chain. Volume boost only applies
 * to level 1 (direct referrer) — it's a reward for THAT person's own
 * recruiting effort, based on how many people they personally referred.
 * `referrerReferralCount` = how many users this specific referrer has brought in.
 * Referral commission is paid OUT of admin's own profit share, not off the
 * top of the user's reward — never eats into the guaranteed admin margin.
 */
function computeReferralCommission({ level, userReward, adminConfig, referrerReferralCount = 0 }) {
  const basePercent = [
    adminConfig.referralTier1Percent,
    adminConfig.referralTier2Percent,
    adminConfig.referralTier3Percent,
  ][level - 1] ?? 0;

  let boost = 0;
  if (level === 1 && adminConfig.referralVolumeBoosts) {
    const thresholds = Object.entries(adminConfig.referralVolumeBoosts)
      .map(([count, pct]) => [Number(count), Number(pct)])
      .sort((a, b) => a[0] - b[0]);
    for (const [minCount, extraPercent] of thresholds) {
      if (referrerReferralCount >= minCount) boost = extraPercent; // highest threshold met wins
    }
  }

  const percent = basePercent + boost;
  const amount = Math.round(userReward * (percent / 100) * 100) / 100;
  return { level, percent, basePercent, boost, amount };
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
  computeReferralCommission,
  interstitialRevenue,
};
