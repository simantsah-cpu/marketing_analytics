import re
import os

filepath = 'src/services/data-service.js'
with open(filepath, 'r') as f:
    content = f.read()

replacement = """async function getMockCommercialPerformance(propertyId, filters) {
  await delay(200)

  const affiliates = [
    { affiliateId: 'awin (bulk)', sessions: 2498, bookings: 841, revenue: 71374, convRate: 0.0337, convRateStr: '3.37%', aov: 84.87, wowRevenue: 0.058 },
    { affiliateId: '57697', sessions: 366, bookings: 366, revenue: 31149, convRate: 0.0391, convRateStr: '3.91%*', aov: 85.11, wowRevenue: 0.092 },
    { affiliateId: '63136', sessions: 189, bookings: 170, revenue: 15556, convRate: 0.0424, convRateStr: '4.24%*', aov: 91.51, wowRevenue: 0.087 },
    { affiliateId: '71759', sessions: 82, bookings: 99, revenue: 7553, convRate: 0.0417, convRateStr: '4.17%*', aov: 76.29, wowRevenue: -0.014 },
    { affiliateId: '313605', sessions: 227, bookings: 64, revenue: 5421, convRate: 0.0281, convRateStr: '2.81%', aov: 84.70, wowRevenue: 0.073 },
    { affiliateId: '264419', sessions: 144, bookings: 31, revenue: 2628, convRate: 0.0215, convRateStr: '2.15%', aov: 84.77, wowRevenue: 0.181 },
    { affiliateId: '412875', sessions: 51, bookings: 18, revenue: 1527, convRate: 0.0353, convRateStr: '3.53%', aov: 84.83, wowRevenue: 0.021 },
    { affiliateId: 'awin', sessions: 0, bookings: 0, revenue: 0, convRate: 0.034, convRateStr: '3.40%', aov: 84.87, wowRevenue: 0 },
    { affiliateId: '321967', sessions: 0, bookings: 0, revenue: 0, convRate: 0.031, convRateStr: '3.10%', aov: 0, wowRevenue: 0 },
  ]

  const convTrend = [
    { date: '2026-02-26', value: 3.1 },
    { date: '2026-02-27', value: 3.0 },
    { date: '2026-02-28', value: 3.4 },
    { date: '2026-03-01', value: 3.5 },
    { date: '2026-03-02', value: 3.2 },
  ]

  const dailyRevenue = [
    { date: '2026-02-26', revenue: 16000 },
    { date: '2026-02-27', revenue: 16500 },
    { date: '2026-02-28', revenue: 20000 },
    { date: '2026-03-01', revenue: 23000 },
    { date: '2026-03-02', revenue: 22500 },
  ]

  const byConvRate = [
    { affiliateId: '63136', convRate: 0.042 },
    { affiliateId: '71759', convRate: 0.042 },
    { affiliateId: '57697', convRate: 0.039 },
    { affiliateId: '412875', convRate: 0.035 },
    { affiliateId: 'awin', convRate: 0.034 },
    { affiliateId: '321967', convRate: 0.031 },
  ]

  const byAov = [
    { affiliateId: '63136', aov: 91.51 },
    { affiliateId: '57697', aov: 85.11 },
    { affiliateId: 'awin', aov: 84.87 },
    { affiliateId: '412875', aov: 84.83 },
    { affiliateId: '313605', aov: 84.70 },
    { affiliateId: '71759', aov: 76.29 },
  ]

  const leaderBoardAffiliates = affiliates.filter(a => ['awin (bulk)','57697','63136','71759','313605','264419','412875'].includes(a.affiliateId));

  return {
    kpis: {
      revenue: { value: 93200, prev: 93200 / 1.061 },
      bookings: { value: 1099, prev: 1099 / 1.083 },
      convRate: { value: 0.0324, prev: 0.0324 + 0.0004 },
      aov: { value: 84.80, prev: 84.80 / 0.98 },
    },
    convTrend,
    dailyRevenue,
    byConvRate,
    byAov,
    affiliates: leaderBoardAffiliates,
  }
}"""

pattern = re.compile(r"async function getMockCommercialPerformance.*?affiliates: affiliatesWithHealth,\s*}\n}", re.DOTALL)
new_content = pattern.sub(replacement, content)

if new_content == content:
    print("NO MATCH FOUND")
else:
    with open(filepath, 'w') as f:
        f.write(new_content)
    print("SUCCESS")
