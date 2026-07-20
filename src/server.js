require("dotenv").config();
const express = require("express");
const cors = require("cors");
const path = require("path");
const { telegramAuthMiddleware } = require("./lib/telegramAuth");

const authRoutes = require("./routes/auth");
const dashboardRoutes = require("./routes/dashboard");
const taskRoutes = require("./routes/tasks");
const walletRoutes = require("./routes/wallet");
const adminRoutes = require("./routes/admin");
const adslotRoutes = require("./routes/adslots");

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "..", "public")));

// public (route itself still requires a verified Telegram session, just no user record needed yet)
app.use("/api/auth", telegramAuthMiddleware, authRoutes);

// everything below requires a verified Telegram session
app.use("/api/dashboard", telegramAuthMiddleware, dashboardRoutes);
app.use("/api/tasks", telegramAuthMiddleware, taskRoutes);
app.use("/api/wallet", telegramAuthMiddleware, walletRoutes);
app.use("/api/admin", telegramAuthMiddleware, adminRoutes);
app.use("/api/adslots", telegramAuthMiddleware, adslotRoutes);

app.get("/health", (req, res) => res.json({ ok: true }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`CoinVault API listening on :${PORT}`));

// start the Telegram bot in the same process (fine for Railway single-service deploy)
require("./bot");
