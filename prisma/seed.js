const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

async function main() {
  await prisma.adminConfig.upsert({
    where: { id: 1 },
    update: {},
    create: {
      id: 1,
      defaultRevenueSharePercent: 50,
      minWithdraw: 20000,
      withdrawFeePercent: 5,
      referralTier1Percent: 10,
      referralTier2Percent: 5,
      referralTier3Percent: 2,
      vipPrices: { "1": 20000, "2": 50000, "3": 100000, "4": 200000 },
      vipRevenueBoost: { "1": 5, "2": 10, "3": 15, "4": 20 },
      interstitialEveryNClicks: 3,
    },
  });

  // NOTE: adminRevenuePerAction = the REAL per-view payout your ad network
  // dashboard reports (check Monetag/Adexium/Adsgram stats page and update
  // these numbers periodically — they fluctuate with fill rate & geo).
  const tasks = [
    {
      title: "Xem video nhận thưởng",
      description: "Xem hết video quảng cáo để nhận tiền ngay",
      type: "REWARDED_VIDEO",
      network: "MONETAG",
      adminRevenuePerAction: 200, // VND admin actually gets per view (example)
      revenueSharePercent: 50,
      cooldownSeconds: 30,
      dailyLimit: 60,
      totalLimitPerUser: 0,
      globalDailyLimit: 0,       // set a real number once you know your Monetag daily ad budget/fill
      zoneIds: ["9000001", "9000002", "9000003"], // replace with your real Monetag zone IDs
      sortOrder: 1,
    },
    {
      title: "Xem quảng cáo Adexium",
      description: "Nhận thưởng qua Adexium rewarded ad",
      type: "REWARDED_VIDEO",
      network: "ADEXIUM",
      adminRevenuePerAction: 180,
      revenueSharePercent: 50,
      cooldownSeconds: 30,
      dailyLimit: 60,
      zoneIds: ["adexium-zone-1", "adexium-zone-2"], // replace with your real Adexium placement IDs
      sortOrder: 2,
    },
    {
      title: "Vòng quay Adsgram",
      description: "Xem quảng cáo Adsgram để quay thưởng",
      type: "REWARDED_VIDEO",
      network: "ADSGRAM",
      adminRevenuePerAction: 150,
      revenueSharePercent: 50,
      cooldownSeconds: 45,
      dailyLimit: 40,
      zoneIds: ["ads-block-1", "ads-block-2", "ads-block-3"], // replace with your real Adsgram block IDs
      sortOrder: 3,
    },
    {
      title: "Điểm danh hàng ngày",
      description: "Điểm danh mỗi ngày để nhận thưởng chuỗi ngày",
      type: "CHECKIN",
      network: "NONE",
      adminRevenuePerAction: 0,
      fixedReward: 500,
      cooldownSeconds: 0,
      dailyLimit: 1,
      sortOrder: 4,
    },
    {
      title: "Tham gia kênh Telegram",
      description: "Follow kênh chính thức để nhận thưởng 1 lần",
      type: "SOCIAL",
      network: "NONE",
      adminRevenuePerAction: 0,
      fixedReward: 2000,
      cooldownSeconds: 0,
      dailyLimit: 1,
      sortOrder: 5,
    },
  ];

  for (const t of tasks) {
    const exists = await prisma.adTask.findFirst({ where: { title: t.title } });
    if (!exists) await prisma.adTask.create({ data: t });
  }

  // Example Ad Slot (Adsterra-style raw script embed). Left inactive/commented
  // as a template — copy the real snippet from your Adsterra dashboard, paste
  // it as `rawEmbedCode`, and either seed it here or add it via the admin panel
  // "Ad Slots" tab directly (easier, no redeploy needed).
  //
  // await prisma.adSlot.upsert({
  //   where: { id: "adsterra-social-bar" },
  //   update: {},
  //   create: {
  //     id: "adsterra-social-bar",
  //     name: "Adsterra Social Bar",
  //     network: "adsterra",
  //     placement: "GLOBAL_SCRIPT",
  //     page: "GLOBAL",
  //     rawEmbedCode: `<script type="text/javascript" src="//PASTE-YOUR-REAL-ADSTERRA-URL"></script>`,
  //     active: true,
  //   },
  // });

  console.log("Seed complete.");
}

main().finally(() => prisma.$disconnect());
