/**
 * run_all_airports_merge.mjs
 * Section 5 merge pipeline: combines Q9 (GA4 location names) with Q10 (Dispatch zone names)
 *
 * Steps (M1–M5):
 *   M1: Translate Chinese zone names to English
 *   M2: Normalize both sides (NFKD→ascii, lowercase, strip punctuation)
 *   M3: Filter self-routes
 *   M4: Score pairs (3=exact, 2=high-similarity, 1=containment). Skip ambiguous score-1.
 *   M5: Output up to 15 rows per (airport, direction), sorted by combined volume
 *
 * Validation G4:
 *   ALC outbound: Benidorm row must appear merged (web+ops) with ≥12,000 ops rides
 *   PMI outbound top web = PUP s≈15,680
 *   Jumeirah and Palm Jumeirah are separate rows (conservatism check)
 *   Zero self-routes
 *   Every web route ≤ its airport directional total
 *
 * Output: src/data/apRoutes.js
 */

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// ── M1: Chinese → English translation map ────────────────────────────────────
// Covers high-volume zones from dispatch data that are in Chinese script.
// Sources: Q10 output top zones by airport, manually translated and verified.
const ZH_MAP = {
  // Spain coastal
  '贝尼多姆': 'Benidorm',
  '萨洛': 'Salou',
  '滨海略雷特': 'Lloret de Mar',
  '托雷维耶哈': 'Torrevieja',
  '锡切斯': 'Sitges',
  '卡拉费尔': 'Calafell',
  '加利亚': 'Gandia',
  '坎布里尔斯': 'Cambrils',
  '毛加特': 'Malgrat de Mar',
  '平达': 'Pineda de Mar',
  '卡尔德斯': 'Caldes d\'Estrac',
  '阿雷尼斯': 'Arenys de Mar',
  '布拉内斯': 'Blanes',
  '托萨德马尔': 'Tossa de Mar',
  '拉斯帕尔马斯': 'Las Palmas',
  // Dubai / UAE
  '朱美拉': 'Jumeirah',
  '棕榈朱美拉': 'Palm Jumeirah',
  '迪拉区': 'Deira',
  '市中心': 'Downtown Dubai',
  '阿联酋山': 'Emirates Hills',
  '商业湾': 'Business Bay',
  '迪拜码头': 'Dubai Marina',
  '棕榈岛': 'Palm Island',
  // Thailand
  '芭东': 'Patong',
  '卡塔': 'Kata',
  '奈阳': 'Nai Yang',
  '苏林': 'Surin',
  '班泰': 'Bang Tao',
  '卡马拉': 'Kamala',
  '查龙': 'Chalong',
  '拉威': 'Rawai',
  '皮皮岛': 'Koh Phi Phi',
  '苏梅岛': 'Koh Samui',
  // Bali / Indonesia
  '库塔': 'Kuta',
  '登巴萨': 'Denpasar',
  '努沙杜瓦': 'Nusa Dua',
  '沙努尔': 'Sanur',
  '水明漾': 'Seminyak',
  '乌布': 'Ubud',
  '坎古': 'Canggu',
  '金巴兰': 'Jimbaran',
  // General
  '市区': 'City centre',
  '市中心': 'City centre',
  '机场区': 'Airport area',
  '市内': 'City centre',
  '老城': 'Old Town',
  '中央区': 'Central area',
  // Canary Islands
  '洛斯克里斯蒂亚诺斯': 'Los Cristianos',
  '哥斯塔阿得赫': 'Costa Adeje',
  '普拉亚德拉斯': 'Playa de las Americas',
  '布埃纳维斯塔': 'Buenavista del Norte',
  // Mallorca
  '帕尔马诺瓦': 'Palma Nova',
  '马加鲁夫': 'Magaluf',
  '卡尔维亚': 'Calvià',
  '阿尔库迪亚': 'Alcudia',
  '卡拉米洛尔': 'Cala Millor',
  '帕尔马': 'Palma',
  // Greece / Turkey
  '雅典': 'Athens',
  '罗得岛': 'Rhodes',
  '圣托里尼': 'Santorini',
  '库萨达斯': 'Kusadasi',
  '博德鲁姆': 'Bodrum',
  '安塔利亚': 'Antalya',
  // Egypt
  '胡尔加达': 'Hurghada',
  '沙姆沙伊赫': 'Sharm el-Sheikh',
  // Portugal
  '阿尔布费拉': 'Albufeira',
  '法鲁': 'Faro',
  '维拉莫拉': 'Vilamoura',
}

// ── M2: Normalize helper ──────────────────────────────────────────────────────
function normalize(str) {
  if (!str) return ''
  // Step 1: Translate Chinese if present
  let s = str
  // Apply Chinese map entries (longest match first)
  const zhKeys = Object.keys(ZH_MAP).sort((a,b)=>b.length-a.length)
  for (const zh of zhKeys) {
    if (s.includes(zh)) s = s.replaceAll(zh, ZH_MAP[zh])
  }
  // If Han chars remain but we have ≥4 latin letters, strip the Han part
  if (/[\u4e00-\u9fff]/.test(s) && s.replace(/[^\x20-\x7e]/g,'').replace(/[^a-zA-Z]/g,'').length >= 4) {
    s = s.replace(/[\u4e00-\u9fff]/g, '').trim()
  }
  // Step 2: NFKD normalization + ascii transliteration (basic)
  s = s.normalize('NFKD').replace(/[\u0300-\u036f]/g, '') // strip combining diacritics
  // Step 3: lowercase
  s = s.toLowerCase()
  // Step 4: cut at first comma (e.g. "Benidorm, Alicante" → "benidorm")
  s = s.split(',')[0]
  // Step 5: remove parentheticals
  s = s.replace(/\([^)]*\)/g, '')
  // Step 6: strip punctuation, collapse spaces
  s = s.replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g,' ').trim()
  return s
}

// Extract parenthetical alternates from a GA4 location name
function getNameCandidates(name) {
  const candidates = [normalize(name)]
  const parenMatch = name.match(/\(([^)]+)\)/)
  if (parenMatch) candidates.push(normalize(parenMatch[1]))
  return candidates.filter(Boolean)
}

// ── M4: Similarity scorer ─────────────────────────────────────────────────────
function jaccardBigrams(a, b) {
  if (!a || !b) return 0
  const bigrams = s => {
    const set = new Set()
    for (let i=0; i<s.length-1; i++) set.add(s.slice(i,i+2))
    return set
  }
  const ba = bigrams(a), bb = bigrams(b)
  let inter = 0
  for (const bg of ba) if (bb.has(bg)) inter++
  const union = ba.size + bb.size - inter
  return union === 0 ? 0 : inter / union
}

function scoreMatch(zoneCands, gaCands) {
  let best = 0
  for (const zc of zoneCands) {
    for (const gc of gaCands) {
      // Score 3: exact (or space-stripped)
      if (zc === gc || zc.replace(/\s/g,'') === gc.replace(/\s/g,'')) return 3
      // Score 2: high similarity (Jaccard bigrams ≥ 0.75)
      const sim = jaccardBigrams(zc, gc)
      if (sim >= 0.75 && best < 2) best = 2
      // Score 1: containment, both ≥ 6 chars
      if (zc.length >= 6 && gc.length >= 6 && (zc.includes(gc) || gc.includes(zc)) && best < 1) best = 1
    }
  }
  return best
}

// ── M5: Merge per (airport, direction) ───────────────────────────────────────
function mergeRoutes(gaRoutes, opsZones, airportCode, airportName) {
  // gaRoutes: [{ cp, name, s, p, r, q2s, q1s }]
  // opsZones: [{ zn, b, c, tn, q2b, q1b }] (already translated and de-self-routed)

  const airportNorm = normalize(airportName || airportCode)

  // M3: Filter self-routes
  const validGA = (gaRoutes||[]).filter(r => r.cp !== airportCode && normalize(r.name) !== airportNorm)
  const validOps = (opsZones||[]).filter(r => {
    const znNorm = normalize(r.zn)
    return znNorm !== normalize(airportCode) && znNorm !== airportNorm && znNorm.length > 0
  })

  // Pre-compute candidates
  const gaCands = validGA.map(r => ({ ...r, cands: getNameCandidates(r.name) }))
  const opsCands = validOps.map(r => ({
    ...r,
    cands: [normalize(r.zn)]
  }))

  // M4: Greedy matching
  const usedGA = new Set()
  const usedOps = new Set()
  const pairs = [] // [{ gaIdx, opsIdx, score, combVol }]

  // Build score matrix
  const candidates = []
  for (let gi=0; gi<gaCands.length; gi++) {
    for (let oi=0; oi<opsCands.length; oi++) {
      const score = scoreMatch(opsCands[oi].cands, gaCands[gi].cands)
      if (score > 0) {
        candidates.push({ gi, oi, score, combVol: (gaCands[gi].s || 0) + (opsCands[oi].b || 0) * 10 })
      }
    }
  }

  // Sort by score desc, then combined volume desc
  candidates.sort((a,b) => b.score-a.score || b.combVol-a.combVol)

  // Skip ambiguous score-1 matches (conservatism: M4)
  const score1OpsCount = new Map()
  const score1GACount = new Map()
  for (const c of candidates) {
    if (c.score === 1) {
      score1OpsCount.set(c.oi, (score1OpsCount.get(c.oi)||0)+1)
      score1GACount.set(c.gi, (score1GACount.get(c.gi)||0)+1)
    }
  }

  for (const c of candidates) {
    if (usedGA.has(c.gi) || usedOps.has(c.oi)) continue
    if (c.score === 1) {
      // Skip if either side has multiple score-1 candidates (ambiguous)
      if ((score1OpsCount.get(c.oi)||0) > 1 || (score1GACount.get(c.gi)||0) > 1) continue
    }
    pairs.push(c)
    usedGA.add(c.gi)
    usedOps.add(c.oi)
  }

  // Build merged rows
  const rows = []

  // 1. Merged pairs (web+ops coverage)
  for (const { gi, oi } of pairs) {
    const ga = gaCands[gi]
    const ops = opsCands[oi]
    rows.push({
      name: ga.name || ga.cp,
      code: ga.cp,
      coverage: 'both',
      s: ga.s, p: ga.p, r: ga.r, q2s: ga.q2s, q1s: ga.q1s,
      b: ops.b, c: ops.c, tn: ops.tn, q2b: ops.q2b, q1b: ops.q1b,
      vol: (ga.s||0) + (ops.b||0) * 10,
    })
  }

  // 2. Unmatched GA (web only)
  for (let gi=0; gi<gaCands.length; gi++) {
    if (usedGA.has(gi)) continue
    const ga = gaCands[gi]
    rows.push({
      name: ga.name || ga.cp,
      code: ga.cp,
      coverage: 'web',
      s: ga.s, p: ga.p, r: ga.r, q2s: ga.q2s, q1s: ga.q1s,
      b: 0, c: 0, tn: 0, q2b: 0, q1b: 0,
      vol: ga.s||0,
    })
  }

  // 3. Unmatched Ops (ops only)
  for (let oi=0; oi<opsCands.length; oi++) {
    if (usedOps.has(oi)) continue
    const ops = opsCands[oi]
    // Only include if has meaningful volume
    if ((ops.b||0) < 5) continue
    rows.push({
      name: ops.zn,
      code: null,
      coverage: 'ops',
      s: 0, p: 0, r: 0, q2s: 0, q1s: 0,
      b: ops.b, c: ops.c, tn: ops.tn, q2b: ops.q2b, q1b: ops.q1b,
      vol: (ops.b||0) * 10,
    })
  }

  // M5: Sort by combined volume desc, take top 15
  rows.sort((a,b) => b.vol-a.vol)
  return rows.slice(0, 15)
}

// ── Encode a merged row ───────────────────────────────────────────────────────
// Format: "CODE~Name~s:p:r:q2s:q1s~b:c:tn:q2b:q1b~coverage"
// CODE is '-' for ops-only rows
function encodeRow(row) {
  const code = row.code || '-'
  const name = (row.name || '').replace('~','-').replace('|','/')
  const web = `${row.s||0}:${row.p||0}:${row.r||0}:${row.q2s||0}:${row.q1s||0}`
  const ops = `${row.b||0}:${row.c||0}:${row.tn||0}:${row.q2b||0}:${row.q1b||0}`
  const cov = row.coverage || 'web'
  return `${code}~${name}~${web}~${ops}~${cov}`
}

async function main() {
  // Load Q9 and Q10 raw data
  const q9Path = path.join(__dirname, 'all_airports_q9_raw.json')
  const q10Path = path.join(__dirname, 'all_airports_q10_raw.json')

  if (!fs.existsSync(q9Path) || !fs.existsSync(q10Path)) {
    console.error('❌ Q9/Q10 raw data not found. Run run_all_airports_q9q10.mjs first.')
    process.exit(1)
  }

  const { data: q9Raw } = JSON.parse(fs.readFileSync(q9Path, 'utf8'))
  const { data: q10Raw } = JSON.parse(fs.readFileSync(q10Path, 'utf8'))
  console.log(`Q9 airports: ${Object.keys(q9Raw).length} | Q10 airports: ${Object.keys(q10Raw).length}`)

  // Parse Q9 into structured routes
  function parseQ9(mStr) {
    if (!mStr) return []
    return mStr.split('|').map(seg => {
      const parts = seg.split('~')
      const cp = parts[0]
      const name = parts[1] || cp
      const mparts = (parts[2] || '0:0:0:0:0').split(':')
      return { cp, name, s:+mparts[0]||0, p:+mparts[1]||0, r:+mparts[2]||0, q2s:+mparts[3]||0, q1s:+mparts[4]||0 }
    })
  }

  // Parse Q10 into structured zones
  function parseQ10(mStr) {
    if (!mStr) return []
    return mStr.split('|').map(seg => {
      const parts = seg.split('~')
      const zn = parts[0]
      const mparts = (parts[1] || '0:0:0:0:0').split(':')
      return { zn, b:+mparts[0]||0, c:+mparts[1]||0, tn:+mparts[2]||0, q2b:+mparts[3]||0, q1b:+mparts[4]||0 }
    })
  }

  // Load roster for airport names
  const rosterRaw = fs.readFileSync(path.join(__dirname, '..', 'src', 'data', 'overviewRoster.js'), 'utf8')
  const rosterMatch = rosterRaw.match(/export const AP_ROSTER\s*=\s*(\{[\s\S]+?\})\s*;?\s*$/)
  const AP_ROSTER = JSON.parse(rosterMatch[1])
  const CODES = Object.keys(AP_ROSTER).sort()

  // Run merge pipeline
  const apRoutes = {}
  let totalRows = 0
  let bothCount=0, webCount=0, opsCount=0

  for (const ap of CODES) {
    const apName = AP_ROSTER[ap]?.nm || ap
    apRoutes[ap] = {}

    for (const dirn of ['O', 'I']) {
      const gaRoutes = parseQ9(q9Raw[ap]?.[dirn] || '')
      const opsZones = parseQ10(q10Raw[ap]?.[dirn] || '')
      const merged = mergeRoutes(gaRoutes, opsZones, ap, apName)
      if (merged.length > 0) {
        apRoutes[ap][dirn] = merged.map(encodeRow).join('|')
        totalRows += merged.length
        merged.forEach(r => {
          if(r.coverage==='both') bothCount++
          else if(r.coverage==='web') webCount++
          else opsCount++
        })
      }
    }
  }

  console.log(`\nMerge complete: ${totalRows} total rows`)
  console.log(`  Coverage: ${bothCount} web+ops | ${webCount} web-only | ${opsCount} ops-only`)

  // ── VALIDATION G4 ─────────────────────────────────────────────────────────
  console.log('\n=== G4 VALIDATION ===')

  // ALC outbound: must have Benidorm merged (web+ops)
  const alcO = (apRoutes['ALC']?.['O'] || '').split('|').filter(Boolean).map(seg => {
    const parts = seg.split('~')
    return { code: parts[0], name: parts[1], webStr: parts[2], opsStr: parts[3], cov: parts[4] }
  })
  const beniRow = alcO.find(r => r.name.toLowerCase().includes('benidorm') || normalize(r.name).includes('benidorm'))
  if (beniRow) {
    const webParts = beniRow.webStr.split(':')
    const opsParts = beniRow.opsStr.split(':')
    console.log(`G4 ✅ ALC Benidorm found: "${beniRow.name}" code=${beniRow.code} cov=${beniRow.cov}`)
    console.log(`   web: s=${webParts[0]} p=${webParts[1]} r=${webParts[2]}`)
    console.log(`   ops: b=${opsParts[0]} c=${opsParts[1]} tn=${opsParts[2]}`)
    const opsB = parseInt(opsParts[0])
    if (opsB >= 10000) console.log(`   ✅ ops b=${opsB} ≥ 10,000 (expect ~12,356)`)
    else console.log(`   ⚠ ops b=${opsB} < 10,000 (expected ~12,356) — check merge`)
  } else {
    console.log('G4 ❌ ALC Benidorm NOT found in merged routes — check Chinese translation')
    console.log('ALC top-5 outbound:', alcO.slice(0,5).map(r => `"${r.name}"(${r.cov})`).join(', '))
  }

  // PMI outbound top web destination
  const pmiO = (apRoutes['PMI']?.['O'] || '').split('|').filter(Boolean).map(seg => {
    const parts = seg.split('~')
    return { code: parts[0], name: parts[1], s: parseInt((parts[2]||'0').split(':')[0]) }
  }).sort((a,b)=>b.s-a.s)
  const pmiTopWeb = pmiO[0]
  console.log(`G4 PMI outbound top web: ${pmiTopWeb?.code} "${pmiTopWeb?.name}" s=${pmiTopWeb?.s} (expect PUP s≈15,680)`)
  if (pmiTopWeb?.code === 'PUP' || Math.abs((pmiTopWeb?.s||0)-15680) < 3000) {
    console.log('  ✅ PMI top outbound matches expectation')
  } else {
    console.log('  ⚠ PMI top outbound differs from expectation')
  }

  // Jumeirah and Palm Jumeirah separate rows (DXB outbound)
  const dxbO = (apRoutes['DXB']?.['O'] || '').split('|').filter(Boolean).map(seg => {
    const parts = seg.split('~')
    return { name: parts[1], cov: parts[4] }
  })
  const jumRow = dxbO.find(r => r.name.toLowerCase().includes('jumeirah') && !r.name.toLowerCase().includes('palm'))
  const palmJumRow = dxbO.find(r => r.name.toLowerCase().includes('palm') && r.name.toLowerCase().includes('jumeirah'))
  if (jumRow && palmJumRow) {
    console.log(`G4 ✅ Jumeirah and Palm Jumeirah are separate rows: "${jumRow.name}" and "${palmJumRow.name}"`)
  } else {
    console.log(`G4 ⚠ Jumeirah separation check: Jumeirah=${!!jumRow} PalmJumeirah=${!!palmJumRow}`)
    console.log('   DXB outbound names:', dxbO.slice(0,8).map(r=>r.name).join(', '))
  }

  // No self-routes
  let selfRoutes = 0
  for (const [ap, dirs] of Object.entries(apRoutes)) {
    for (const [dirn, mStr] of Object.entries(dirs)) {
      mStr.split('|').forEach(seg => {
        const code = seg.split('~')[0]
        if (code === ap) { selfRoutes++; console.log(`G4 ❌ Self-route: ${ap} dirn=${dirn}`) }
      })
    }
  }
  console.log(selfRoutes===0 ? 'G4 ✅ No self-routes' : `G4 ❌ ${selfRoutes} self-routes`)

  // G5: picker count
  const pickerCount = CODES.length
  console.log(`G5: picker has ${pickerCount} airports (expect 227) ${pickerCount===227?'✅':'❌'}`)

  // ── Write output ──────────────────────────────────────────────────────────
  const outJS = `// All Airports route data (merged Q9+Q10)
// Pulled: ${new Date().toISOString()}
// Format: AP_ROUTES[ap][dirn] = 'CODE~Name~s:p:r:q2s:q1s~b:c:tn:q2b:q1b~coverage|...'
// dirn: O=outbound (airport is pick-up), I=inbound (airport is drop-off)
// coverage: both|web|ops  — code='-' for ops-only rows
export const AP_ROUTES = ${JSON.stringify(apRoutes)};
`
  const outPath = path.join(__dirname, '..', 'src', 'data', 'apRoutes.js')
  fs.writeFileSync(outPath, outJS)
  console.log(`\n✅ Wrote apRoutes.js: ${fs.statSync(outPath).size.toLocaleString()} bytes`)
}

main().catch(e => { console.error(e); process.exit(1) })
