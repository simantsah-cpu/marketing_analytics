import { readFileSync } from 'fs'
import { createSign } from 'crypto'

const SA = JSON.parse(readFileSync('/Users/simant/Desktop/smart-altar-488316-u7-aab78b399ac7.json','utf8'))
const now = Math.floor(Date.now()/1000)
const b64u = s => Buffer.from(s).toString('base64').replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_')
const hdr = b64u(JSON.stringify({alg:'RS256',typ:'JWT'}))
const pld = b64u(JSON.stringify({iss:SA.client_email,scope:'https://www.googleapis.com/auth/analytics.readonly',aud:'https://oauth2.googleapis.com/token',exp:now+3600,iat:now}))
const sign = createSign('RSA-SHA256'); sign.update(hdr+'.'+pld)
const jwt = hdr+'.'+pld+'.'+sign.sign(SA.private_key,'base64').replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_')
const tok = await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:'grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion='+jwt}).then(r=>r.json())

const run = async (body) => fetch('https://analyticsdata.googleapis.com/v1beta/properties/259261360:runReport',{method:'POST',headers:{Authorization:'Bearer '+tok.access_token,'Content-Type':'application/json'},body:JSON.stringify(body)}).then(r=>r.json())

const daily = await run({
  dateRanges:[{startDate:'30daysAgo',endDate:'today'}],
  dimensions:[{name:'date'}],
  metrics:[{name:'eventCount'},{name:'sessions'},{name:'totalUsers'}],
  dimensionFilter:{filter:{fieldName:'eventName',stringFilter:{matchType:'EXACT',value:'blog_banner_click'}}},
  orderBys:[{dimension:{dimensionName:'date'}}]
})
console.log('=== DAILY BREAKDOWN (30d) ===')
let totalE=0, totalS=0
;(daily.rows||[]).forEach(r=>{
  const d=r.dimensionValues[0].value, e=r.metricValues[0].value, s=r.metricValues[1].value, u=r.metricValues[2].value
  console.log(d, '  events='+e, '  sessions='+s, '  users='+u)
  totalE+=parseInt(e); totalS+=parseInt(s)
})
console.log('SUMMED total events='+totalE, ' sessions='+totalS)
