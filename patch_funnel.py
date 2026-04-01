import re
import os

filepath = 'src/services/data-service.js'
with open(filepath, 'r') as f:
    content = f.read()

replacement = """async function getMockFunnelAnalysis(propertyId, filters) {
  await delay(200)

  const affiliates = [
    { affiliateId: 'awin (bulk)', dropOff: 712, checkoutRate: 0.403 },
    { affiliateId: '57697', dropOff: 198, checkoutRate: 0.431 },
    { affiliateId: '63136', dropOff: 142, checkoutRate: 0.462 },
    { affiliateId: '313605', dropOff: 97, checkoutRate: 0.354 },
    { affiliateId: '264419', dropOff: 84, checkoutRate: 0.286 },
    { affiliateId: '71759', dropOff: 61, checkoutRate: 0.448 },
    { affiliateId: '321967', dropOff: 0, checkoutRate: 0.378 }, // From right chart
  ]

  const funnelSteps = [
    { label: 'Sessions', value: 3394, pct: 100 },
    { label: 'view_search_results', value: 2614, pct: 77.0 },
    { label: 'form_submit', value: 2190, pct: 64.5 },
    { label: 'begin_checkout', value: 2847, pct: 83.9 },
    { label: 'checkout', value: 2052, pct: 60.5 },
    { label: 'purchase', value: 1089, pct: 32.4 },
  ]

  const funnelTrend = [
    {
      stage: 'Sessions',
      data: [
        { date: '2026-02-26', value: 460 },
        { date: '2026-02-27', value: 470 },
        { date: '2026-02-28', value: 580 },
        { date: '2026-03-01', value: 680 },
        { date: '2026-03-02', value: 650 },
      ]
    },
    {
      stage: 'begin_checkout',
      data: [
        { date: '2026-02-26', value: 380 },
        { date: '2026-02-27', value: 390 },
        { date: '2026-02-28', value: 490 },
        { date: '2026-03-01', value: 570 },
        { date: '2026-03-02', value: 550 },
      ]
    },
    {
      stage: 'Purchase',
      data: [
        { date: '2026-02-26', value: 150 },
        { date: '2026-02-27', value: 150 },
        { date: '2026-02-28', value: 190 },
        { date: '2026-03-01', value: 220 },
        { date: '2026-03-02', value: 210 },
      ]
    }
  ]

  return {
    kpis: {
      evtBeginCheckout: { value: 2847, prev: 2847 / 1.074 },
      checkoutToPurchase: { value: 0.386, prev: 0.386 - 0.011 },
      evtViewSearch: { value: 2614, prev: 2614 / 1.052 },
      evtPaymentFail: { value: 31, prev: 31 - 3 },
    },
    funnelSteps,
    funnelTrend,
    affiliateCheckoutDrop: affiliates,
    paymentFailTrend: { mobile: [], desktop: [] },
    deadAffiliates: [],
  }
}"""

pattern = re.compile(r"async function getMockFunnelAnalysis.*?deadAffiliates: affiliates.filter[^\n]+\n\s*}\n}", re.DOTALL)
new_content = pattern.sub(replacement, content)

if new_content == content:
    print("NO MATCH FOUND")
else:
    with open(filepath, 'w') as f:
        f.write(new_content)
    print("SUCCESS")
