'use strict';

// Local landing page shown in the first tab when a profile launches.
// A verification dashboard: confirm the exit IP/location, the account this
// identity is for, the live 2FA code, and the active fingerprint — at a glance.
// Self-contained (inline CSS/JS, system fonts) so it works offline via setContent.

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
    platform: (meta.platform && meta.platform.name) || '',
    account: (meta.platform && meta.platform.account) || '',
    twofa: (meta.platform && meta.platform.twofa) || '',
    proxyType: meta.proxyType || 'No Proxy',
    remark: meta.remark || '',
    tags: (meta.tags || []).join(', '),
    fp: {
      timezone: fp.timezone || '',
      locale: fp.locale || '',
      platform: fp.uaPlatform || '',
      screen: fp.screen ? `${fp.screen.width} × ${fp.screen.height}` : '',
      cores: fp.hardwareConcurrency || '',
      memory: fp.deviceMemory ? fp.deviceMemory + ' GB' : '',
      webgl: fp.webglRenderer || '',
      webrtc: fp.webrtc || '',
    },
  };
  const json = JSON.stringify(data).replace(/</g, '\\u003c');

  return `<!doctype html><html lang="th"><head><meta charset="utf-8"/>
<title>GoGiGi · ${esc(data.name || 'Profile')}</title>
<style>
:root{
  --bg:#0f1116;--panel:#171a21;--panel2:#1e212a;--line:rgba(255,255,255,.07);--line2:rgba(255,255,255,.12);
  --text:#e9eaee;--dim:#949aa6;--mute:#636977;--accent:#6b8bff;--live:#36ca8c;--warn:#e3ab45;
  --mono:'Cascadia Code','Consolas',ui-monospace,monospace;
  --ui:-apple-system,'Segoe UI Variable','Segoe UI','Leelawadee UI',system-ui,sans-serif;
}
*{box-sizing:border-box}
html,body{margin:0}
body{background:var(--bg);color:var(--text);font-family:var(--ui);font-size:14px;line-height:1.5}
.mono{font-family:var(--mono)}
.wrap{max-width:860px;margin:0 auto;padding:22px 24px 48px}

/* top bar */
.bar{display:flex;align-items:center;gap:11px;padding:4px 2px 20px}
.bar .live{display:inline-flex;align-items:center;gap:7px;font-size:12.5px;color:var(--live);font-weight:600}
.bar .live .d{width:8px;height:8px;border-radius:50%;background:var(--live);box-shadow:0 0 0 4px rgba(54,202,140,.16)}
.bar .nm{margin-left:auto;text-align:right}
.bar .nm b{font-weight:650;font-size:14px}
.bar .nm span{display:block;color:var(--mute);font-size:12px}

/* location hero */
.loc{border:1px solid var(--line);border-radius:16px;background:
  radial-gradient(130% 120% at 0% 0%, rgba(107,139,255,.08), transparent 60%),var(--panel);
  padding:22px 24px;margin-bottom:18px}
.loc .where{display:flex;align-items:center;gap:13px}
.loc .flag{font-size:15px;font-weight:700;letter-spacing:.5px;padding:8px 11px;min-width:46px;text-align:center;
  border:1px solid var(--line2);border-radius:11px;background:var(--panel2);line-height:1}
.loc .place{font-size:16px;font-weight:600}
.loc .place .sub{color:var(--mute);font-weight:400}
.loc .ipline{display:flex;align-items:baseline;gap:14px;margin-top:14px;flex-wrap:wrap}
.loc .ip{font-family:var(--mono);font-size:30px;font-weight:600;letter-spacing:.5px}
.loc .lat{color:var(--mute);font-size:12.5px;font-family:var(--mono)}
.loc .proxy{margin-top:6px;color:var(--dim);font-size:12.5px;font-family:var(--mono);word-break:break-all}
.chip{display:inline-flex;align-items:center;gap:6px;font-size:11.5px;font-weight:600;padding:3px 10px;border-radius:999px}
.chip.warn{background:rgba(227,171,69,.14);color:var(--warn)}

/* grid of panels */
.cols{display:grid;grid-template-columns:1fr 1fr;gap:16px;align-items:start}
@media (max-width:680px){.cols{grid-template-columns:1fr}}
.panel{border:1px solid var(--line);border-radius:14px;background:var(--panel);overflow:hidden}
.panel h2{margin:0;font-size:12.5px;font-weight:650;color:var(--dim);padding:14px 18px;border-bottom:1px solid var(--line)}
.dl{padding:4px 18px 10px}
.dl .r{display:flex;gap:14px;padding:9px 0;border-bottom:1px solid var(--line)}
.dl .r:last-child{border-bottom:none}
.dl .k{width:108px;flex:none;color:var(--mute);font-size:13px}
.dl .v{color:var(--text);word-break:break-word;min-width:0}
.span2{grid-column:1 / -1}

/* 2FA tile */
.tfa .big{padding:16px 18px;display:flex;align-items:center;gap:16px}
.tfa .code{font-family:var(--mono);font-size:30px;font-weight:650;letter-spacing:4px}
.tfa .right{margin-left:auto;display:flex;flex-direction:column;align-items:flex-end;gap:8px}
.tfa .cd{color:var(--mute);font-size:12px;font-family:var(--mono)}
.track{height:4px;border-radius:999px;background:var(--panel2);overflow:hidden;margin:0 18px 16px}
.track>i{display:block;height:100%;background:var(--live);width:100%;transition:width 1s linear}

/* buttons / links */
.cp{background:none;border:1px solid var(--line2);color:var(--dim);border-radius:8px;padding:5px 11px;cursor:pointer;font:inherit;font-size:12px}
.cp:hover{color:var(--text);border-color:var(--line2);background:var(--panel2)}
.cp:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.checks{margin-top:20px;color:var(--mute);font-size:13px;display:flex;align-items:center;gap:7px;flex-wrap:wrap}
.checks a{color:var(--accent);text-decoration:none}
.checks a:hover{text-decoration:underline}
.sep{color:var(--line2)}
@media (prefers-reduced-motion:reduce){.track>i{transition:none}}
</style></head>
<body>
<div class="wrap">
  <div class="bar">
    <span class="live"><span class="d"></span>เชื่อมต่อแล้ว</span>
    <div class="nm"><b id="t_name"></b><span id="t_sub"></span></div>
  </div>

  <div class="loc">
    <div class="where">
      <div class="flag" id="flag">🌐</div>
      <div class="place"><span id="place">กำลังตรวจตำแหน่ง…</span></div>
    </div>
    <div class="ipline">
      <span class="ip" id="ip">—</span>
      <button class="cp" id="ipcopy" style="display:none">คัดลอก IP</button>
      <span class="lat" id="lat"></span>
      <span class="chip warn" id="noproxy" style="display:none">ไม่มี proxy · ใช้ IP เครื่องจริง</span>
    </div>
    <div class="proxy" id="proxy"></div>
  </div>

  <div class="cols">
    <div class="panel">
      <h2>บัญชี</h2>
      <div class="dl">
        <div class="r"><div class="k">ชื่อ</div><div class="v" id="d_name"></div></div>
        <div class="r" id="r_platform"><div class="k">แพลตฟอร์ม</div><div class="v" id="d_platform"></div></div>
        <div class="r" id="r_account"><div class="k">บัญชี</div><div class="v mono" id="d_account"></div></div>
        <div class="r"><div class="k">Profile ID</div><div class="v mono" id="d_id"></div></div>
        <div class="r"><div class="k">กลุ่ม</div><div class="v" id="d_group"></div></div>
        <div class="r"><div class="k">เปิดเมื่อ</div><div class="v" id="d_startup"></div></div>
        <div class="r"><div class="k">แท็ก</div><div class="v" id="d_tags"></div></div>
      </div>
    </div>

    <div class="panel tfa" id="tfaPanel" style="display:none">
      <h2>รหัส 2FA</h2>
      <div class="big">
        <span class="code" id="tfa_code">— —</span>
        <div class="right"><button class="cp" id="tfa_copy">คัดลอก</button><span class="cd" id="tfa_cd"></span></div>
      </div>
      <div class="track"><i id="tfa_bar"></i></div>
    </div>
    <div class="panel" id="notePanel" style="display:none">
      <h2>2FA / หมายเหตุ</h2>
      <div class="dl"><div class="r" style="border:none"><div class="v" id="d_note"></div></div></div>
    </div>
  </div>

  <div class="panel span2" style="margin-top:16px">
    <h2>Fingerprint</h2>
    <div class="dl" style="display:grid;grid-template-columns:1fr 1fr;gap:0 24px">
      <div class="r"><div class="k">Timezone</div><div class="v" id="f_tz"></div></div>
      <div class="r"><div class="k">หน้าจอ</div><div class="v mono" id="f_screen"></div></div>
      <div class="r"><div class="k">Locale</div><div class="v" id="f_locale"></div></div>
      <div class="r"><div class="k">CPU · RAM</div><div class="v mono" id="f_hw"></div></div>
      <div class="r"><div class="k">OS</div><div class="v" id="f_os"></div></div>
      <div class="r"><div class="k">WebRTC</div><div class="v" id="f_webrtc"></div></div>
      <div class="r span2" style="grid-column:1 / -1"><div class="k">WebGL</div><div class="v" id="f_webgl"></div></div>
      <div class="r span2" style="grid-column:1 / -1"><div class="k">User-Agent</div><div class="v mono" style="font-size:12px" id="f_ua"></div></div>
    </div>
  </div>

  <div class="checks">
    <span>ตรวจลายนิ้วมือ:</span>
    <a href="https://www.browserscan.net/" target="_blank">BrowserScan</a><span class="sep">·</span>
    <a href="https://browserleaks.com/" target="_blank">BrowserLeaks</a><span class="sep">·</span>
    <a href="https://whoer.net/" target="_blank">Whoer</a><span class="sep">·</span>
    <a href="https://www.ip2location.com/demo" target="_blank">IP2Location</a>
  </div>
</div>

<script>
const D = JSON.parse('${json}');
const $ = (id) => document.getElementById(id);
const set = (id, v) => { const e = $(id); if (e) e.textContent = (v === '' || v == null) ? '—' : v; };
const flagOf = (cc) => { if(!cc||cc.length!==2) return '🌐'; const b=0x1f1e6; return String.fromCodePoint(b+cc.toUpperCase().charCodeAt(0)-65, b+cc.toUpperCase().charCodeAt(1)-65); };
const copyBtn = (btn, text, label) => { btn.addEventListener('click', () => { navigator.clipboard.writeText(text).then(()=>{ const o=btn.textContent; btn.textContent='คัดลอกแล้ว'; setTimeout(()=>btn.textContent=o,1200); }); }); };

set('t_name', D.name || 'โปรไฟล์');
$('t_sub').textContent = [D.platform, D.account].filter(Boolean).join(' · ');
set('d_name', D.name); set('d_id', D.profileNo); set('d_group', D.group);
set('d_startup', D.startup); set('d_tags', D.tags);
if (D.platform) set('d_platform', D.platform); else $('r_platform').style.display='none';
if (D.account) set('d_account', D.account); else $('r_account').style.display='none';
$('proxy').textContent = D.proxyType;
if (D.proxyType === 'No Proxy') $('noproxy').style.display='';

set('f_tz', D.fp.timezone || '(ตามระบบ)');
set('f_locale', D.fp.locale || navigator.language || '(ตามระบบ)');
set('f_os', (D.fp.platform || navigator.platform || '') + ' · Windows');
set('f_screen', screen.width + ' × ' + screen.height);
set('f_hw', (navigator.hardwareConcurrency||'?') + ' cores · ' + (navigator.deviceMemory||'?') + ' GB');
set('f_webgl', D.fp.webgl);
set('f_webrtc', D.fp.webrtc === 'disabled' ? 'ปิด' : (D.fp.webrtc === 'real' ? 'จริง' : 'ตาม proxy'));
set('f_ua', navigator.userAgent);

// live exit IP (through the profile proxy)
const t0 = Date.now();
// Several services: free ones rate-limit (429) when many profiles share an IP.
const LOOKUPS = [
  ['https://ipwho.is/', j => j.success !== false && j.ip && { ip: j.ip, cc: j.country_code, place: [j.country, j.region, j.city] }],
  ['https://ipinfo.io/json', j => j.ip && { ip: j.ip, cc: j.country, place: [j.country, j.region, j.city] }],
  ['https://api.country.is/', j => j.ip && { ip: j.ip, cc: j.country, place: [j.country] }],
];
(async () => {
  for (const [url, map] of LOOKUPS) {
    try {
      const ctl = new AbortController(); const tm = setTimeout(() => ctl.abort(), 7000);
      const res = await fetch(url, { signal: ctl.signal, cache: 'no-store' }); clearTimeout(tm);
      if (!res.ok) continue;
      const g = map(await res.json()); if (!g) continue;
      $('ip').textContent = g.ip;
      $('flag').textContent = flagOf(g.cc);
      $('place').textContent = g.place.filter(Boolean).join(' · ');
      $('lat').textContent = (Date.now() - t0) + ' ms';
      const btn = $('ipcopy'); btn.style.display = ''; copyBtn(btn, g.ip);
      return;
    } catch (e) { /* try next */ }
  }
  $('place').textContent = 'ตรวจตำแหน่งไม่ได้ — proxy อาจใช้ไม่ได้ หรือบริการตรวจ IP ไม่ตอบ'; $('ip').textContent = '—';
})();

// ---- 2FA ----
const raw2fa = (D.twofa||'').replace(/\\s/g,'');
const isSecret = /^[A-Z2-7]{16,}$/i.test(raw2fa);
if (!D.twofa) { /* nothing */ }
else if (!isSecret) { $('notePanel').style.display=''; set('d_note', D.twofa); }
else {
  $('tfaPanel').style.display='';
  const b32 = (s)=>{ const A='ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'; s=s.toUpperCase().replace(/=+$/,''); let bits=''; for(const c of s){ const v=A.indexOf(c); if(v<0) continue; bits+=v.toString(2).padStart(5,'0'); } const out=[]; for(let i=0;i+8<=bits.length;i+=8){ out.push(parseInt(bits.substr(i,8),2)); } return out; };
  const rotl=(n,s)=>((n<<s)|(n>>>(32-s)));
  function sha1(bytes){ let H0=0x67452301,H1=0xEFCDAB89,H2=0x98BADCFE,H3=0x10325476,H4=0xC3D2E1F0; const b=bytes.slice(); const l=b.length*8; b.push(0x80); while(b.length%64!==56) b.push(0); for(let i=7;i>=0;i--) b.push(Math.floor(l/Math.pow(2,8*i))&0xff); const w=new Array(80); for(let o=0;o<b.length;o+=64){ for(let i=0;i<16;i++) w[i]=(b[o+i*4]<<24)|(b[o+i*4+1]<<16)|(b[o+i*4+2]<<8)|(b[o+i*4+3]); for(let i=16;i<80;i++){ const v=w[i-3]^w[i-8]^w[i-14]^w[i-16]; w[i]=rotl(v,1); } let a=H0,bb=H1,c=H2,d=H3,e=H4; for(let i=0;i<80;i++){ let f,k; if(i<20){f=(bb&c)|((~bb)&d);k=0x5A827999;} else if(i<40){f=bb^c^d;k=0x6ED9EBA1;} else if(i<60){f=(bb&c)|(bb&d)|(c&d);k=0x8F1BBCDC;} else {f=bb^c^d;k=0xCA62C1D6;} const t=(rotl(a,5)+f+e+k+w[i])|0; e=d;d=c;c=rotl(bb,30);bb=a;a=t; } H0=(H0+a)|0;H1=(H1+bb)|0;H2=(H2+c)|0;H3=(H3+d)|0;H4=(H4+e)|0; } const out=[]; [H0,H1,H2,H3,H4].forEach(h=>out.push((h>>>24)&0xff,(h>>>16)&0xff,(h>>>8)&0xff,h&0xff)); return out; }
  function hmac(key,msg){ const bl=64; if(key.length>bl) key=sha1(key); key=key.concat(new Array(bl-key.length).fill(0)); const ok=key.map(x=>x^0x5c), ik=key.map(x=>x^0x36); return sha1(ok.concat(sha1(ik.concat(msg)))); }
  function totp(){ const key=b32(raw2fa); const ctr=Math.floor(Date.now()/1000/30); const msg=[0,0,0,0,(ctr>>>24)&0xff,(ctr>>>16)&0xff,(ctr>>>8)&0xff,ctr&0xff]; const h=hmac(key,msg); const off=h[19]&0xf; const code=(((h[off]&0x7f)<<24)|(h[off+1]<<16)|(h[off+2]<<8)|h[off+3])%1000000; return String(code).padStart(6,'0'); }
  let cur='';
  $('tfa_copy').addEventListener('click', ()=>{ if(cur) navigator.clipboard.writeText(cur).then(()=>{ const b=$('tfa_copy'); b.textContent='คัดลอกแล้ว'; setTimeout(()=>b.textContent='คัดลอก',1200); }); });
  function tick(){ try{ cur=totp(); const left=30-(Math.floor(Date.now()/1000)%30); $('tfa_code').textContent=cur.slice(0,3)+' '+cur.slice(3); $('tfa_cd').textContent='เหลือ '+left+' วิ'; $('tfa_bar').style.width=(left/30*100)+'%'; }catch(e){ $('tfa_code').textContent='รหัสไม่ถูกต้อง'; } }
  tick(); setInterval(tick,1000);
}
</script>
</body></html>`;
}

module.exports = { buildHtml };
