/**
 * Adexium Stats API client.
 * Docs (per publisher account page): Bearer token auth, per-widget stats
 * broken down by country. We sum across countries (and across multiple
 * widget IDs if a task rotates several) to get the task's true overall
 * revenue and impressions for a date range.
 */

async function fetchWidgetStats(widgetId, startDate, endDate) {
  const url = `https://api.tg-ads.co/api/v1/widget/stats/${widgetId}/?startDate=${startDate}&endDate=${endDate}&viewBy=country`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${process.env.ADEXIUM_API_TOKEN}` },
  });
  if (!res.ok) {
    throw new Error(`Adexium API lỗi ${res.status} cho widget ${widgetId}`);
  }
  return res.json(); // array of { id, value, clicks, revenue, impressions, ctr, cpm }
}

/**
 * Sums revenue (USD) and impressions across ALL widget IDs used by a task
 * (it may rotate several) and ALL countries, for the given date range.
 */
async function getTaskAdexiumTotals(widgetIds, startDate, endDate) {
  let totalRevenueUsd = 0;
  let totalImpressions = 0;

  for (const widgetId of widgetIds) {
    const rows = await fetchWidgetStats(widgetId, startDate, endDate);
    for (const row of rows) {
      totalRevenueUsd += Number(row.revenue) || 0;
      totalImpressions += Number(row.impressions) || 0;
    }
  }

  return { totalRevenueUsd, totalImpressions };
}

module.exports = { fetchWidgetStats, getTaskAdexiumTotals };
