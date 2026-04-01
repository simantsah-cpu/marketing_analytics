/**
 * AFFILIATE LOOKUP MAP
 * Source: Google Sheet — https://docs.google.com/spreadsheets/d/1ZE36IRNVCQRBVNS46_Y88RzPuh6esepukGBOqJU36tg
 * Columns: name, publisherId (string), promotion_method, parent_promotion_method
 *
 * Left-join semantics: the sheet is the primary source.
 * If GA4 sends a publisher ID not in this map, we fall back to showing the raw ID.
 */

const AFFILIATE_DATA = [
  { id: '63136',   name: 'Blue Light Card LTD',               promotion_method: 'Loyalty',                  parent: 'Content' },
  { id: '57697',   name: 'Topcashback Ltd',                   promotion_method: 'Cashback',                 parent: 'Content' },
  { id: '98969',   name: 'NextGen Shopping, Inc.',            promotion_method: 'Discount Code',            parent: 'Content' },
  { id: '54760',   name: 'Quidco',                            promotion_method: 'Cashback',                 parent: 'Content' },
  { id: '46407',   name: 'Reward Gateway',                    promotion_method: 'Cashback',                 parent: 'Content' },
  { id: '71759',   name: 'Collinson Valuedynamx',             promotion_method: 'Loyalty',                  parent: 'Content' },
  { id: '282949',  name: 'Atolls UK',                         promotion_method: 'Discount Code',            parent: 'Content' },
  { id: '67035',   name: 'RetailMeNot UK Ltd (Vouchercodes)', promotion_method: 'Discount Code',            parent: 'Content' },
  { id: '695179',  name: 'Value Media',                       promotion_method: 'Ad Networks',              parent: 'Display' },
  { id: '685769',  name: 'Linkbux',                           promotion_method: 'Sub Networks',             parent: 'Display' },
  { id: '789945',  name: 'FatCoupon Technology Ltd',          promotion_method: 'Cashback',                 parent: 'Content' },
  { id: '57434',   name: 'easyfundraising',                   promotion_method: 'Loyalty',                  parent: 'Content' },
  { id: '61664',   name: 'Pion (Student Beans)',              promotion_method: 'Discount Code',            parent: 'Content' },
  { id: '84119',   name: 'Savoo.co.uk',                       promotion_method: 'Discount Code',            parent: 'Content' },
  { id: '214459',  name: 'Honey Science Corporation',         promotion_method: 'Discount Code',            parent: 'Content' },
  { id: '294583',  name: 'LatestDeals Ltd',                   promotion_method: 'Discount Code',            parent: 'Content' },
  { id: '504061',  name: 'Coupert',                           promotion_method: 'Discount Code',            parent: 'Content' },
  { id: '85386',   name: 'Sovrn Commerce',                    promotion_method: 'Sub Networks',             parent: 'Display' },
  { id: '94838',   name: 'Groupon UK',                        promotion_method: 'Discount Code',            parent: 'Content' },
  { id: '69605',   name: 'Next Jump',                         promotion_method: 'Loyalty',                  parent: 'Content' },
  { id: '271445',  name: 'Sovrn Commerce Deals & Incentives', promotion_method: 'Sub Networks',             parent: 'Display' },
  { id: '654885',  name: 'Kindred Soul Ltd',                  promotion_method: 'Loyalty',                  parent: 'Content' },
  { id: '165574',  name: 'OneVoice Digital Limited',          promotion_method: 'Discount Code',            parent: 'Content' },
  { id: '189069',  name: 'Webgears GmbH',                     promotion_method: 'Discount Code',            parent: 'Content' },
  { id: '217829',  name: 'TIKATO S.R.L',                      promotion_method: 'Discount Code',            parent: 'Content' },
  { id: '211491',  name: 'ShopGo',                            promotion_method: 'Cashback',                 parent: 'Content' },
  { id: '248741',  name: 'Klarna Bank AB UK Branch',          promotion_method: 'Discount Code',            parent: 'Content' },
  { id: '334049',  name: 'Oberst BV (SökRabatt.se)',          promotion_method: 'Discount Code',            parent: 'Content' },
  { id: '1543081', name: 'ConvertSocial FZ-LLC',              promotion_method: 'Sub Networks',             parent: 'Display' },
  { id: '1848300', name: 'digidip GmbH',                      promotion_method: 'Discount Code',            parent: 'Content' },
  { id: '497557',  name: 'VC Students',                       promotion_method: 'Discount Code',            parent: 'Content' },
  { id: '65970',   name: 'Future Publishing Ltd Savings',     promotion_method: 'Discount Code',            parent: 'Content' },
  { id: '918477',  name: 'Servicenet A.A LTD',                promotion_method: 'Sub Networks',             parent: 'Display' },
  { id: '74988',   name: 'Kelkoo UK / Ireland',               promotion_method: 'Comparison Engine',        parent: 'Content' },
  { id: '73585',   name: 'KidStart Limited',                  promotion_method: 'Loyalty',                  parent: 'Content' },
  { id: '69783',   name: 'Weather2Travel.com',                promotion_method: 'Editorial Content',        parent: 'Content' },
  { id: '313605',  name: 'Brandreward - Incentivized',        promotion_method: 'Sub Networks',             parent: 'Display' },
  { id: '274181',  name: 'BRAND REWARD INC',                  promotion_method: 'Sub Networks',             parent: 'Display' },
  { id: '249371',  name: 'digidip UK and USA - Incentivized', promotion_method: 'Sub Networks',             parent: 'Display' },
  { id: '72311',   name: 'Shopnomix LLC',                     promotion_method: 'Direct Linking',           parent: 'Search' },
  { id: '68727',   name: 'Incentive Networks',                promotion_method: 'Loyalty',                  parent: 'Content' },
  { id: '196639',  name: 'GoCashBack.com',                    promotion_method: 'Cashback',                 parent: 'Content' },
  { id: '1658349', name: 'EASY CLICK LIMITED',                promotion_method: 'Social Content',           parent: 'Content' },
  { id: '102356',  name: 'Benifex UK',                        promotion_method: 'Loyalty',                  parent: 'Content' },
  { id: '101248',  name: 'TakeAds GmbH',                      promotion_method: 'Sub Networks',             parent: 'Display' },
  { id: '592707',  name: 'IsellNow',                          promotion_method: 'Sub Networks',             parent: 'Display' },
  { id: '1263017', name: 'Links Circle PTY LTD',              promotion_method: 'Sub Networks',             parent: 'Display' },
  { id: '138269',  name: 'Picodi.com S.A. / UK',              promotion_method: 'Discount Code',            parent: 'Content' },
  { id: '133182',  name: 'Terryberry UK',                     promotion_method: 'Discount Code',            parent: 'Content' },
  { id: '264419',  name: 'FlexOffers.com, LLC',               promotion_method: 'Sub Networks',             parent: 'Display' },
  { id: '1181566', name: 'Glomnipresent Corp',                promotion_method: 'Editorial Content',        parent: 'Content' },
  { id: '294723',  name: 'Seville Traveller',                 promotion_method: 'Social Content',           parent: 'Content' },
  { id: '302433',  name: 'cashdo',                            promotion_method: 'Cashback',                 parent: 'Content' },
  { id: '333587',  name: 'Atolls DE (iGraal)',                promotion_method: 'Cashback',                 parent: 'Content' },
  { id: '168390',  name: 'Girl about the Globe',              promotion_method: 'Direct Traffic',           parent: 'Display' },
  { id: '517635',  name: 'ZAirports',                         promotion_method: 'Contextual Targeting',     parent: 'Display' },
  { id: '133790',  name: 'Future Proof Digital Media Ltd',    promotion_method: 'Discount Code',            parent: 'Content' },
  { id: '194605',  name: 'Deal Savings LLC',                  promotion_method: 'Discount Code',            parent: 'Content' },
  { id: '284335',  name: 'CouponBirds',                       promotion_method: 'Discount Code',            parent: 'Content' },
  { id: '233859',  name: 'Prodege, LLC',                      promotion_method: 'Loyalty',                  parent: 'Content' },
  { id: '192957',  name: 'vouchercloud | IE',                 promotion_method: 'Discount Code',            parent: 'Content' },
  { id: '696205',  name: 'Klarna',                            promotion_method: 'Shopping Directory',       parent: 'Content' },
  { id: '13539',   name: 'Elgar Associates Limited',          promotion_method: 'Loyalty',                  parent: 'Content' },
  { id: '632320',  name: 'DealFinder - VCUK',                 promotion_method: 'Discount Code',            parent: 'Content' },
  { id: '422807',  name: 'The World In My Pocket',            promotion_method: 'Social Content',           parent: 'Content' },
  { id: '1819366', name: 'Skyscanner [Brand Partnerships]',   promotion_method: 'Loyalty',                  parent: 'Content' },
  { id: '45628',   name: 'Example Publisher',                 promotion_method: 'Ad Networks',              parent: 'Display' },
  { id: '143466',  name: 'YIELDKIT GmbH',                     promotion_method: 'Sub Networks',             parent: 'Display' },
  { id: '135115',  name: 'Travel-Dealz',                      promotion_method: 'Editorial Content',        parent: 'Content' },
  { id: '822693',  name: 'Opera Cashback',                    promotion_method: 'Cashback',                 parent: 'Content' },
  { id: '1471986', name: 'PUERTO DE LA CRUZ INFO',            promotion_method: 'Social Content',           parent: 'Content' },
  { id: '157382',  name: 'Sunil Uttamchandani',               promotion_method: 'Direct Traffic',           parent: 'Display' },
  { id: '81392',   name: 'RetailMeNot.com',                   promotion_method: 'Discount Code',            parent: 'Content' },
  { id: '59262',   name: 'Happy Travel Limited',              promotion_method: 'Editorial Content',        parent: 'Content' },
  { id: '1858990', name: 'Takeads FZ-LLC',                    promotion_method: 'Sub Networks',             parent: 'Display' },
  { id: '23141',   name: 'Sunseeker Holidays',                promotion_method: 'Editorial Content',        parent: 'Content' },
  { id: '375095',  name: 'Global Media B.V.',                 promotion_method: 'Communities & UGC',        parent: 'Content' },
  { id: '177945',  name: 'Demand.io',                         promotion_method: 'Discount Code',            parent: 'Content' },
  { id: '195149',  name: '55Haitao.com',                      promotion_method: 'Cashback',                 parent: 'Content' },
  { id: '158650',  name: 'Webloyalty International Sarl',     promotion_method: 'Loyalty',                  parent: 'Content' },
]

// Build fast O(1) lookup by publisher ID
const byId = Object.fromEntries(AFFILIATE_DATA.map(a => [String(a.id), a]))

/**
 * Resolve an affiliate ID to its display name.
 * Falls back to the raw ID if not in the map.
 */
export function resolveAffiliateName(id) {
  const key = String(id).trim()
  return byId[key]?.name ?? key
}

/**
 * Resolve an affiliate ID to its promotion_method.
 * Falls back to 'Unknown' if not in the map.
 */
export function resolvePromotionMethod(id) {
  const key = String(id).trim()
  return byId[key]?.promotion_method ?? 'N/A'
}

/**
 * Resolve an affiliate ID to its parent_promotion_method.
 */
export function resolveParentPromotion(id) {
  const key = String(id).trim()
  return byId[key]?.parent ?? 'N/A'
}

/**
 * Given an affiliateId and groupBy mode ('affiliate' | 'promotion_method'),
 * return the display label to use in charts/tables.
 */
export function resolveLabel(id, groupBy = 'affiliate') {
  if (groupBy === 'promotion_method') return resolvePromotionMethod(id)
  return resolveAffiliateName(id)
}

export const AFFILIATE_MAP = byId
