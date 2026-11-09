'use strict';

// Builds the local landing page shown in the first tab when a profile launches.
// Mirrors AdsPower's start page: live exit IP/geo, account info, a live 2FA code
// (when the account's 2FA field holds a TOTP secret), the applied fingerprint,
// and quick links to fingerprint-check sites. Served via page.setContent().

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function buildHtml(meta, fp) {
  const data = {
    name: meta.name || '',
    startup: new Date().toLocaleString(),
    group: meta.group || '',
    profileNo: meta.profileNo || meta.id || '',
    id: meta.id || '',
    platform: (meta.platform && meta.platform.name) || '',
    account: (meta.platform && meta.platform.account) || '',
    twofa: (meta.platform && meta.platform.twofa) || '',
    proxyType: meta.proxyType || 'No Proxy',
    remark: meta.remark || '',
    tags: (meta.tags || []).join(', '),
    fp: {
      timezone: fp.timezone || '(ตามระบบ)',
      locale: fp.locale || '(ตามระบบ)',
      platform: fp.uaPlatform || '',
      screen: fp.screen ? `${fp.screen.width} × ${fp.screen.height}` : '',
      cores: fp.hardwareConcurrency || '',
      memory: fp.deviceMemory ? fp.deviceMemory + ' GB' : '',
      webgl: fp.webglRenderer || '',
      webrtc: fp.webrtc || '',
      ua: fp.userAgent || '',
    },
  };
  const json = JSON.stringify(data).replace(/</g, '\\u003c');

  return `<!doctype html><html lang="th"><head><meta charset="utf-8"/>
<title>GoGiGi · ${esc(data.name || 'Profile')}</title>
<style>
:root{--bg:#0f1116;--card:#171a21;--line:rgba(255,255,255,.07);--text:#e8e9ed;--dim:#9297a3;--mute:#646a78;--accent:#5c7cfa;--live:#35c98b}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--text);font-family:'Segoe UI',system-ui,sans-serif;font-size:14px}
.hero{background:linear-gradient(120deg,#3b63e0,#5c7cfa);padding:34px 20px;text-align:center;color:#fff}
.hero .ip{font-size:34px;font-weight:800;letter-spacing:.5px;display:flex;align-items:center;gap:10px;justify-content:center}
.hero .geo{opacity:.9;margin-top:6px;font-size:15px}
.wrap{max-width:840px;margin:-18px auto 40px;padding:0 18px}
.links{display:flex;gap:16px;justify-content:center;padding:18px 0;flex-wrap:wrap}
.links a{color:var(--accent);text-decoration:none;font-weight:600;font-size:13px}
.card{background:var(--card);border:1px solid var(--line);border-radius:16px;box-shadow:0 18px 50px -20px rgba(0,0,0,.6);overflow:hidden;margin-bottom:18px}
.card h2{margin:0;padding:16px 22px;font-size:14px;border-bottom:1px solid var(--line);border-left:3px solid var(--accent)}
.rowx{display:flex;padding:13px 22px;border-bottom:1px solid var(--line);align-items:center}
.rowx:last-child{border-bottom:none}
.rowx .k{width:170px;color:var(--mute);flex:none}
.rowx .v{color:var(--text);word-break:break-word}
.mono{font-family:'Cascadia Code',ui-monospace,monospace}
.pill{display:inline-flex;align-items:center;gap:7px;background:rgba(53,201,139,.14);color:var(--live);padding:3px 11px;border-radius:999px;font-weight:700}
.code{font-family:'Cascadia Code',ui-monospace,monospace;font-size:20px;font-weight:700;letter-spacing:3px}
.cd{color:var(--mute);font-size:12px}
button.cp{background:none;border:1px solid var(--line);color:var(--dim);border-radius:7px;padding:3px 8px;cursor:pointer;font-size:12px;margin-left:8px}
</style></head>
<body>
<div class="hero">
  <div class="ip">📍 <span id="ip">กำลังตรวจ IP…</span></div>
  <div class="geo" id="geo"></div>
</div>
<div class="wrap">
  <div class="links">
    <a href="https://www.browserscan.net/" target="_blank">BrowserScan</a>
    <a href="https://browserleaks.com/" target="_blank">BrowserLeaks</a>
    <a href="https://whoer.net/" target="_blank">Whoer</a>
    <a href="https://www.ip2location.com/demo" target="_blank">IP2Location</a>
  </div>

  <div class="card">
    <h2>ข้อมูลบัญชี</h2>
    <div class="rowx"><div class="k">ชื่อ</div><div class="v" id="d_name"></div></div>
    <div class="rowx"><div class="k">เวลาเปิด</div><div class="v" id="d_startup"></div></div>
    <div class="rowx"><div class="k">กลุ่ม</div><div class="v" id="d_group"></div></div>
    <div class="rowx"><div class="k">Profile ID</div><div class="v mono" id="d_id"></div></div>
    <div class="rowx" id="r_platform"><div class="k">แพลตฟอร์ม</div><div class="v" id="d_platform"></div></div>
    <div class="rowx" id="r_account"><div class="k">บัญชี</div><div class="v" id="d_account"></div></div>
    <div class="rowx" id="r_2fa"><div class="k">2FA</div><div class="v" id="d_2fa"></div></div>
    <div class="rowx"><div class="k">Proxy</div><div class="v" id="d_proxy"></div></div>
    <div class="rowx"><div class="k">Remark</div><div class="v" id="d_remark"></div></div>
    <div class="rowx"><div class="k">แท็ก</div><div class="v" id="d_tags"></div></div>
  </div>

  <div class="card">
    <h2>Fingerprint</h2>
    <div class="rowx"><div class="k">Timezone</div><div class="v" id="f_tz"></div></div>
    <div class="rowx"><div class="k">Locale</div><div class="v" id="f_locale"></div></div>
    <div class="rowx"><div class="k">OS / Platform</div><div class="v" id="f_platform"></div></div>
    <div class="rowx"><div class="k">หน้าจอ</div><div class="v mono" id="f_screen"></div></div>
    <div class="rowx"><div class="k">CPU / RAM</div><div class="v mono" id="f_hw"></div></div>
    <div class="rowx"><div class="k">WebGL</div><div class="v" id="f_webgl"></div></div>
    <div class="rowx"><div class="k">WebRTC</div><div class="v" id="f_webrtc"></div></div>
    <div class="rowx"><div class="k">User-Agent</div><div class="v mono" style="font-size:12px" id="f_ua"></div></div>
  </div>
</div>
<script>
const D = JSON.parse('${json}');
const $ = (id) => document.getElementById(id);
const set = (id, v) => { const e = $(id); if (e) e.textContent = v || '—'; };
set('d_name', D.name); set('d_startup', D.startup); set('d_group', D.group);
set('d_id', D.profileNo); set('d_proxy', D.proxyType); set('d_remark', D.remark); set('d_tags', D.tags);
if (D.platform) set('d_platform', D.platform); else $('r_platform').style.display='none';
if (D.account) set('d_account', D.account); else $('r_account').style.display='none';
set('f_tz', D.fp.timezone); set('f_locale', D.fp.locale);
set('f_platform', (navigator.platform||'') + ' · ' + (navigator.userAgentData && navigator.userAgentData.platform || 'Windows'));
set('f_screen', (screen.width+' × '+screen.height));
set('f_hw', (navigator.hardwareConcurrency||'?')+' cores · '+((navigator.deviceMemory||'?'))+' GB');
set('f_webgl', D.fp.webgl);
set('f_webrtc', D.fp.webrtc);
set('f_ua', navigator.userAgent);

// ---- live exit IP (through the profile's proxy) ----
fetch('https://ipwho.is/').then(r=>r.json()).then(j=>{
  if(j && j.success!==false){
    $('ip').textContent = j.ip;
    $('geo').textContent = [j.country, j.region, j.city].filter(Boolean).join(' / ');
  } else { $('ip').textContent='ตรวจ IP ไม่ได้'; }
}).catch(()=>{ $('ip').textContent='ตรวจ IP ไม่ได้'; });

// ---- 2FA: live TOTP when the field is a base32 secret ----
const raw2fa = (D.twofa||'').replace(/\\s/g,'');
const isSecret = /^[A-Z2-7]{16,}$/i.test(raw2fa);
if(!D.twofa){ $('r_2fa').style.display='none'; }
else if(!isSecret){ set('d_2fa', D.twofa); }
else {
  const el = $('d_2fa');
  const b32 = (s)=>{ const A='ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'; s=s.toUpperCase().replace(/=+$/,''); let bits=''; for(const c of s){ const v=A.indexOf(c); if(v<0) continue; bits+=v.toString(2).padStart(5,'0'); } const out=[]; for(let i=0;i+8<=bits.length;i+=8){ out.push(parseInt(bits.substr(i,8),2)); } return out; };
  const rotl=(n,s)=>((n<<s)|(n>>>(32-s)));
  function sha1(bytes){ let H0=0x67452301,H1=0xEFCDAB89,H2=0x98BADCFE,H3=0x10325476,H4=0xC3D2E1F0; const b=bytes.slice(); const l=b.length*8; b.push(0x80); while(b.length%64!==56) b.push(0); for(let i=7;i>=0;i--) b.push(Math.floor(l/Math.pow(2,8*i))&0xff); const w=new Array(80); for(let o=0;o<b.length;o+=64){ for(let i=0;i<16;i++) w[i]=(b[o+i*4]<<24)|(b[o+i*4+1]<<16)|(b[o+i*4+2]<<8)|(b[o+i*4+3]); for(let i=16;i<80;i++){ const v=w[i-3]^w[i-8]^w[i-14]^w[i-16]; w[i]=rotl(v,1); } let a=H0,bb=H1,c=H2,d=H3,e=H4; for(let i=0;i<80;i++){ let f,k; if(i<20){f=(bb&c)|((~bb)&d);k=0x5A827999;} else if(i<40){f=bb^c^d;k=0x6ED9EBA1;} else if(i<60){f=(bb&c)|(bb&d)|(c&d);k=0x8F1BBCDC;} else {f=bb^c^d;k=0xCA62C1D6;} const t=(rotl(a,5)+f+e+k+w[i])|0; e=d;d=c;c=rotl(bb,30);bb=a;a=t; } H0=(H0+a)|0;H1=(H1+bb)|0;H2=(H2+c)|0;H3=(H3+d)|0;H4=(H4+e)|0; } const out=[]; [H0,H1,H2,H3,H4].forEach(h=>out.push((h>>>24)&0xff,(h>>>16)&0xff,(h>>>8)&0xff,h&0xff)); return out; }
  function hmac(key,msg){ const bl=64; if(key.length>bl) key=sha1(key); key=key.concat(new Array(bl-key.length).fill(0)); const ok=key.map(x=>x^0x5c), ik=key.map(x=>x^0x36); return sha1(ok.concat(sha1(ik.concat(msg)))); }
  function totp(){ const key=b32(raw2fa); const ctr=Math.floor(Date.now()/1000/30); const msg=[0,0,0,0,(ctr>>>24)&0xff,(ctr>>>16)&0xff,(ctr>>>8)&0xff,ctr&0xff]; const h=hmac(key,msg); const off=h[19]&0xf; const code=(((h[off]&0x7f)<<24)|(h[off+1]<<16)|(h[off+2]<<8)|h[off+3])%1000000; return String(code).padStart(6,'0'); }
  function tick(){ try{ const c=totp(); const left=30-(Math.floor(Date.now()/1000)%30); el.innerHTML='<span class="code">'+c.slice(0,3)+' '+c.slice(3)+'</span> <span class="cd">('+left+'s)</span><button class="cp" onclick="navigator.clipboard.writeText(\\''+c+'\\')">คัดลอก</button>'; }catch(e){ set('d_2fa','รหัส 2FA ไม่ถูกต้อง'); } }
  tick(); setInterval(tick,1000);
}
</script>
</body></html>`;
}

module.exports = { buildHtml };
