const express = require("express");
const prisma = require("../lib/prisma");
const router = express.Router();

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
