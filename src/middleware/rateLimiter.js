const prisma = require("../lib/prisma");

/**
 * Full eligibility check for a task completion attempt. Order matters:
 * cheapest/most-common-to-fail checks first.
 *   1. per-user cooldown
 *   2. per-user daily limit
 *   3. per-user lifetime limit
 *   4. global daily limit (whole task, all users — ad budget control)
 *   5. global lifetime limit (whole task, all users)
 */
async function checkTaskEligibility(userId, task) {
  const since = new Date();
  since.setHours(0, 0, 0, 0);

  if (task.cooldownSeconds > 0) {
    const last = await prisma.taskCompletion.findFirst({
      where: { userId, taskId: task.id },
      orderBy: { createdAt: "desc" },
    });
    if (last) {
      const elapsed = (Date.now() - last.createdAt.getTime()) / 1000;
      if (elapsed < task.cooldownSeconds) {
        return { ok: false, reason: `Chờ thêm ${Math.ceil(task.cooldownSeconds - elapsed)}s` };
      }
    }
  }

  if (task.dailyLimit > 0) {
    const countToday = await prisma.taskCompletion.count({
      where: { userId, taskId: task.id, createdAt: { gte: since } },
    });
    if (countToday >= task.dailyLimit) {
      return { ok: false, reason: "Đã đạt giới hạn nhiệm vụ hôm nay" };
    }
  }

  if (task.totalLimitPerUser > 0) {
    const countTotal = await prisma.taskCompletion.count({ where: { userId, taskId: task.id } });
    if (countTotal >= task.totalLimitPerUser) {
      return { ok: false, reason: "Bạn đã hoàn thành tối đa nhiệm vụ này" };
    }
  }

  if (task.globalDailyLimit > 0) {
    const globalToday = await prisma.taskCompletion.count({
      where: { taskId: task.id, createdAt: { gte: since } },
    });
    if (globalToday >= task.globalDailyLimit) {
      return { ok: false, reason: "Nhiệm vụ đã hết lượt hôm nay, quay lại sau" };
    }
  }

  if (task.globalTotalLimit > 0) {
    const globalTotal = await prisma.taskCompletion.count({ where: { taskId: task.id } });
    if (globalTotal >= task.globalTotalLimit) {
      return { ok: false, reason: "Nhiệm vụ đã hết lượt" };
    }
  }

  return { ok: true };
}

/** Picks the next ad zone/block ID for this user+task in round-robin order. */
async function getNextZoneId(userId, task) {
  return getNextRotatingValue(userId, task, task.zoneIds);
}

/** Picks the next direct-link URL for this user+task in round-robin order. */
async function getNextDirectLink(userId, task) {
  return getNextRotatingValue(userId, task, task.directLinkUrls);
}

async function getNextRotatingValue(userId, task, list) {
  const values = Array.isArray(list) ? list : [];
  if (values.length === 0) return null;
  const count = await prisma.taskCompletion.count({ where: { userId, taskId: task.id } });
  return values[count % values.length];
}

module.exports = { checkTaskEligibility, getNextZoneId, getNextDirectLink };
