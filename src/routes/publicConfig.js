const express = require("express");
const router = express.Router();

// GET /api/public/config — no auth, just static info the frontend needs to
// build things like the referral link (t.me/<username>?start=<code>).
router.get("/config", (req, res) => {
  res.json({ botUsername: process.env.BOT_USERNAME || "earningplaycoin_bot" });
});

module.exports = router;
