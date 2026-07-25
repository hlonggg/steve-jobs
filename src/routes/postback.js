const express = require("express");
const prisma = require("../lib/prisma");
const router = express.Router();

/**
 * MONETAG — real documented postback format (GET, query-param macros):
 *   GET /api/postback/monetag?ymid=X&event=Y&zone_id=Z&telegram_id=T&estimated_price=P
 * https://docs.monetag.com/docs/postbacks/
 *
 * Correlates back to the pending (unverified) TaskCompletion we created
 * optimistically when the frontend callback fired, using zone_id + the
 * user's telegramId (most recent unverified match, within a time window).
 * Tops up the difference between what was already paid provisionally and
 * the real reward computed from Monetag's actual estimated_price — never
 * pays MORE than the real number, never goes negative.
 */
router.get("/monetag", async (req, res) => {
  const { zone_id, telegram_id, estimated_price, reward } = req.query;
  if (!zone_id || !telegram_id || estimated_price == null) return res.json({ ok: true, note: "missing fields, ignored" });

  const { splitTaskReward } = require("../lib/economics");

  const user = await prisma.user.findUnique({ where: { telegramId: String(telegram_id) } });
  if (!user) return res.json({ ok: true, note: "user not found" });

  const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000);
  const completion = await prisma.taskCompletion.findFirst({
    where: { userId: user.id, zoneId: String(zone_id), verified: false, createdAt: { gte: fiveMinAgo } },
    orderBy: { createdAt: "desc" },
    include: { task: true },
  });
  if (!completion) return res.json({ ok: true, note: "no matching pending completion" });

  // reward=="no" means Monetag itself confirms this event was NOT monetized —
  // settle it at zero real revenue (don't top up) instead of leaving it stuck
  // "pending" forever. Admin absorbs exactly the provisional amount already
  // paid, nothing more — this is the capped downside the provisional system
  // was built for.
  if (reward === "no") {
    await prisma.taskCompletion.update({
      where: { id: completion.id },
      data: { verified: true, sourceRevenue: 0, adminProfit: -completion.userReward },
    });
    return res.json({ ok: true, confirmed: true, monetized: false, topUp: 0 });
  }

  const config = await prisma.adminConfig.upsert({ where: { id: 1 }, update: {}, create: { id: 1 } });
  const realSourceRevenue = Number(estimated_price) * (config.usdToVndRate || 26300);
  const real = splitTaskReward({ task: completion.task, user, adminConfig: config, sourceRevenue: realSourceRevenue });

  const alreadyPaid = completion.userReward;
  const topUp = Math.max(0, Math.round((real.userReward - alreadyPaid) * 100) / 100);

  await prisma.$transaction([
    prisma.taskCompletion.update({
      where: { id: completion.id },
      data: {
        verified: true,
        sourceRevenue: realSourceRevenue,
        userReward: alreadyPaid + topUp,
        adminProfit: Math.round((realSourceRevenue - (alreadyPaid + topUp)) * 100) / 100,
      },
    }),
    ...(topUp > 0 ? [prisma.user.update({ where: { id: user.id }, data: { balance: { increment: topUp }, totalEarned: { increment: topUp } } })] : []),
  ]);

  res.json({ ok: true, confirmed: true, monetized: true, topUp });
});

/**
 * POST /api/postback/:network?secret=YOUR_SECRET
 *
 * Point this URL at any ad network's "server-to-server postback" /
 * "S2S callback" setting (Adexium confirmed to support this — see
 * https://docs.adexium.io/publisher/integration.html). When the network
 * calls this after a real, verified ad view, we log the raw payload and
 * (if it contains a recognizable revenue field) automatically nudge the
 * matching task's `adminRevenuePerAction` toward the real number using an
 * exponential moving average — no manual daily entry needed for that task.
 *
 * IMPORTANT: every network's payload shape is different and often not
 * fully documented publicly. First deploy, point the network's postback
 * URL here, trigger a real ad view, then check your Railway logs for the
 * "RAW POSTBACK" line to see the exact fields that network actually sends
 * — adjust the `extractRevenue`/`extractTaskId` helpers below to match.
 */

const EMA_ALPHA = 0.3; // how fast the rate reacts to new data (0-1, higher = faster/noisier)

function extractRevenue(body) {
  // Try the common field names networks use. Adjust once you see real payloads.
  const candidates = [body.revenue, body.amount, body.payout, body.value, body.price];
  const found = candidates.find(v => v !== undefined && !isNaN(Number(v)));
  return found !== undefined ? Number(found) : null;
}

function extractTaskId(body, query) {
  return body.taskId || body.task_id || query.taskId || query.task_id || null;
}

router.post("/:network", async (req, res) => {
  const { network } = req.params;
  const expectedSecret = process.env.POSTBACK_SECRET;

  if (expectedSecret && req.query.secret !== expectedSecret) {
    return res.status(401).json({ error: "Invalid postback secret" });
  }

  console.log(`RAW POSTBACK [${network}]:`, JSON.stringify({ query: req.query, body: req.body }));

  const revenue = extractRevenue({ ...req.query, ...req.body });
  const taskId = extractTaskId(req.body, req.query);

  if (revenue == null || !taskId) {
    // Still 200 so the network doesn't retry-spam you — just log for now
    // until you've identified the right fields from the raw log line above.
    return res.json({ ok: true, note: "Logged, but revenue/taskId not recognized yet — check Railway logs and adjust extractRevenue()/extractTaskId()" });
  }

  const task = await prisma.adTask.findUnique({ where: { id: taskId } });
  if (!task) return res.json({ ok: true, note: "taskId not found, ignored" });

  // Exponential moving average — smoothly drifts the rate toward real
  // confirmed revenue instead of jumping wildly on a single data point.
  const newRate = Math.round(task.adminRevenuePerAction * (1 - EMA_ALPHA) + revenue * EMA_ALPHA);
  await prisma.adTask.update({ where: { id: taskId }, data: { adminRevenuePerAction: newRate } });

  res.json({ ok: true, oldRate: task.adminRevenuePerAction, newRate, confirmedRevenue: revenue });
});

module.exports = router;
