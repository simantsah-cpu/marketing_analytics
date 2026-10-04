// Route display labels (Brief 04 §1.3). Route names come from the pricing system and are
// partly Chinese; this transform is display-only — the raw route key is the identity, and it
// stays in tooltips and search. Extend ZH here (and only here); longest tokens first.

export const ZH = [
  ['上海市区左', 'Shanghai city west'], ['吉隆坡市区', 'Kuala Lumpur city centre'], ['市区中心临桥', 'city centre (Linqiao)'],
  ['芭提雅市区', 'Pattaya city'], ['黄金海岸市区', 'Gold Coast city'], ['新加坡市区', 'Singapore city'], ['马德里市区', 'Madrid city centre'],
  ['德里市区', 'Delhi city'], ['多哈市区', 'Doha city'], ['宿务市区', 'Cebu city'], ['港口到城市', 'port to city'],
  ['市区中心', 'city centre'], ['市区中间', 'city middle'], ['市区沙滩', 'city beach'], ['机场范围', 'airport area'],
  ['北墨尔本', 'North Melbourne'], ['南墨尔本', 'South Melbourne'], ['西墨尔本', 'West Melbourne'], ['北悉尼', 'North Sydney'],
  ['卡伦海滩', 'Karon Beach'], ['廊曼机场', 'Don Mueang Airport'], ['滨海略雷特', 'Lloret de Mar'], ['布鲁克林', 'Brooklyn'],
  ['贝尼多姆', 'Benidorm'], ['吉隆坡', 'Kuala Lumpur'], ['曼哈顿', 'Manhattan'], ['新泽西', 'New Jersey'], ['棕榈岛', 'Palm Jumeirah'],
  ['朱美拉', 'Jumeirah'], ['马卡蒂', 'Makati'], ['芽庄市', 'Nha Trang'], ['宁波市', 'Ningbo'], ['市中心', 'city centre'],
  ['迪士尼', 'Disneyland'], ['东京', 'Tokyo'], ['九龙', 'Kowloon'], ['京都', 'Kyoto'], ['会安', 'Hoi An'], ['大阪', 'Osaka'],
  ['横滨', 'Yokohama'], ['福井', 'Fukui'], ['长野', 'Nagano'], ['首尔', 'Seoul'], ['港岛', 'Hong Kong Island'], ['芭东', 'Patong'],
  ['萨洛', 'Salou'], ['市区', 'city centre'], ['机场', 'airport'], ['港口', 'port'],
]

/** Display label for a raw route key: 'ALC - 贝尼多姆' → 'ALC → Benidorm'; '~JFK>' → 'JFK → city, distance-priced'. */
export function routeLabel(key) {
  if (key.startsWith('~')) { // distance-priced
    const [a, b] = key.slice(1).split('>')
    if (a && b) return `${a} → ${b}, distance-priced`
    if (a) return `${a} → city, distance-priced`
    if (b) return `City → ${b}, distance-priced`
    return 'Within city, distance-priced'
  }
  let s = key.replace(/(\d+)\s*[郡区]/g, 'District $1') // "1郡" / "1区" → "District 1"
  for (const [zh, en] of ZH) s = s.split(zh).join(' ' + en + ' ')
  return s.replace(/\s+/g, ' ').replace(/(\S)-\s+(?=\S)/g, '$1-').trim()
    .replace(/\s+-\s+/g, ' → ') // "A - B" → "A → B"
}
