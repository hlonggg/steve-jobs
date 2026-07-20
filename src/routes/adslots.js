const express = require("express");
const prisma = require("../lib/prisma");
const router = express.Router();

// GET /api/adslots?page=DASHBOARD — returns active slots for GLOBAL + the given page
router.get("/", async (req, res) => {
  const page = req.query.page;
  const slots = await prisma.adSlot.findMany({
    where: {
      active: true,
      page: page ? { in: ["GLOBAL", page] } : undefined,
    },
    orderBy: { sortOrder: "asc" },
  });
  res.json({ slots });
});

module.exports = router;
