const express = require("express");
const prisma = require("../lib/prisma");
const router = express.Router();

function genReferralCode(telegramId) {
  return "R" + Buffer.from(telegramId).toString("base64url").slice(0, 8).toUpperCase();
}

// POST /api/auth/session  { refCode?: string }
// req.tgUser is already verified by telegramAuthMiddleware upstream
router.post("/session", async (req, res) => {
  try {
    const { id, username, first_name, photo_url } = req.tgUser;
    const telegramId = String(id);
    const { refCode } = req.body || {};

    let user = await prisma.user.findUnique({ where: { telegramId } });

    if (!user) {
      let referredById = null;
      if (refCode) {
        const referrer = await prisma.user.findUnique({ where: { referralCode: refCode } });
        if (referrer) referredById = referrer.id;
      }
      user = await prisma.user.create({
        data: {
          telegramId,
          username,
          firstName: first_name,
          photoUrl: photo_url,
          referralCode: genReferralCode(telegramId + Date.now()),
          referredById,
          lastIp: req.ip,
          device: req.headers["user-agent"],
        },
      });
    } else {
      user = await prisma.user.update({
        where: { id: user.id },
        data: { username, firstName: first_name, photoUrl: photo_url, lastIp: req.ip },
      });
    }

    if (user.banned) return res.status(403).json({ error: "Tài khoản đã bị khóa: " + (user.banReason || "") });

    res.json({ user });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Lỗi phiên đăng nhập" });
  }
});

module.exports = router;
