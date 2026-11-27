/* Owner tools for the classic page. The server adds this script only for a signed-in owner, and the
   data it reads (/api/fleet.json, /api/activity.json, /api/report.json) is refused to everyone else.
   It adds an owner bar under the header and, on demand, Alerts / Activity Log / Reports panels styled
   with the classic page's own colours and components. Nothing else on the page is changed. */
(function(){
  'use strict';
  var dataEl = document.getElementById('data'); if(!dataEl) return;
  var DATA = JSON.parse(dataEl.textContent);
  var DUTY = {active:'Active', field:'On field duty', leave:'On leave', absent:'Absent', suspended:'Suspended', parked:'Pool', inuse:'In use', vacant:'Vacant'};
  var rows = [], byReg = {};
  DATA.sections.forEach(function(s){ s.rows.forEach(function(r){ var x = Object.assign({}, r, {sec:s}); rows.push(x); if(r.vehicle && !byReg[r.vehicle]) byReg[r.vehicle] = x; }); });

  function esc(s){ return String(s == null ? '' : s).replace(/[&<>"']/g, function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); }
  function short(n){ return String(n||'').replace(/^(Mr|Mrs|Ms|Dr)\.?\s+/i,''); }
  function ago(iso){ if(!iso) return null; var s = (Date.now() - Date.parse(iso))/1000;
    return s < 90 ? 'just now' : s < 3600 ? Math.round(s/60)+' min ago' : s < 86400 ? Math.round(s/3600)+' h ago' : Math.round(s/86400)+' days ago'; }
  function pkt(sec){ return sec == null ? null : new Date(sec*1000).toLocaleString('en-US', {timeZone:'Asia/Karachi', hour:'numeric', minute:'2-digit'}); }
  function hm(min){ if(min == null) return '—'; var h = Math.floor(min/60), m = min % 60; return h ? h+' h '+String(m).padStart(2,'0')+' m' : m+' m'; }
  function pkDay(ms){ return new Date(ms + 5*3600000).toISOString().slice(0,10); }
  function addDays(d, n){ return new Date(Date.parse(d+'T00:00:00Z') + n*86400000).toISOString().slice(0,10); }
  function mod(sec){ var d = new Date(sec*1000 + 5*3600000); return d.getUTCHours()*60 + d.getUTCMinutes(); }
  function clockMin(m){ if(m == null) return '—'; var h = Math.floor(m/60); return ((h+11)%12+1)+':'+String(m%60).padStart(2,'0')+(h < 12 ? ' am' : ' pm'); }
  function person(reg){ var r = byReg[reg];
    return {name: r && r.name ? short(r.name) : (r && r.status === 'parked' ? 'Pool bike' : r ? 'Unassigned' : 'Not on staff list'), post: r ? (r.designation || r.sec.label) : '', sec: r ? r.sec.label : '', r: r}; }
  function get(url){ return fetch(url, {cache:'no-store', credentials:'same-origin'}).then(function(r){ return r.ok ? r.json() : null; }).catch(function(){ return null; }); }

  /* ---------- styles: the classic page's own variables and look ---------- */
  var css = document.createElement('style');
  css.textContent = [
    '.ow-bar{display:flex;flex-wrap:wrap;align-items:center;gap:10px;margin:18px 0 0;padding:12px 14px;border-radius:18px;background:var(--surface);border:1px solid var(--line);box-shadow:var(--shadow)}',
    '.ow-bar .ow-k{font-family:"Playfair Display",Georgia,serif;font-weight:700;color:var(--gold-light);font-size:1.05rem;margin-right:4px}',
    ':root[data-theme="light"] .ow-bar .ow-k{color:#7a5a10}',
    '.ow-b{display:inline-flex;align-items:center;gap:8px;padding:9px 16px;border-radius:99px;cursor:pointer;font:inherit;font-weight:800;font-size:.86rem;text-decoration:none;',
    '  color:#1a1400;background:linear-gradient(180deg,#fcde84,#e0bb4b);border:1px solid #e0bb4b;box-shadow:0 6px 16px rgba(224,187,75,.3),inset 0 1px 0 rgba(255,255,255,.6);transition:transform .15s,box-shadow .2s}',
    '.ow-b:hover{transform:translateY(-2px);box-shadow:0 10px 24px rgba(224,187,75,.5),inset 0 1px 0 rgba(255,255,255,.6)}',
    '.ow-b svg{width:17px;height:17px}',
    '.ow-b.alt{background:var(--surface2);color:var(--text);border-color:var(--line);box-shadow:none}',
    '.ow-b[aria-pressed="true"]{background:linear-gradient(180deg,#5fd38f,#2f9a5a);border-color:#5fd38f;color:#06200d}',
    '.ow-n{display:inline-grid;place-items:center;min-width:20px;height:20px;padding:0 6px;border-radius:99px;background:#e5484d;color:#fff;font-size:.72rem;font-weight:900}',
    '.ow-panel{margin:16px 0 0}',
    '.ow-panel .ph .ow-tools{display:flex;gap:6px;flex-wrap:wrap;align-items:center}',
    '.ow-panel .ph button,.ow-panel .ph input{font:inherit;font-weight:800;font-size:.8rem;padding:6px 11px;border-radius:99px;border:1px solid rgba(252,222,132,.5);background:rgba(252,222,132,.1);color:#fcde84;cursor:pointer}',
    '.ow-panel .ph input{color-scheme:dark;padding:5px 9px}',
    '.ow-panel .ph button[aria-pressed="true"]{background:#e0bb4b;color:#1a1400}',
    '.ow-kpis{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;padding:14px 16px 4px}',
    '.ow-kpis div{background:var(--surface2);border:1px solid var(--line);border-radius:14px;padding:10px 12px}',
    '.ow-kpis b{display:block;font-family:"Playfair Display",Georgia,serif;font-size:1.45rem;color:var(--text)}',
    '.ow-kpis span{display:block;font-size:.78rem;color:var(--muted);font-weight:700}',
    '.ow-tw{overflow:auto;max-height:520px}',
    '.ow-t{width:100%;border-collapse:collapse;font-size:.88rem}',
    '.ow-t th{position:sticky;top:0;background:var(--surface2);color:var(--muted);text-align:left;padding:9px 12px;font-size:.74rem;text-transform:uppercase;letter-spacing:.05em;white-space:nowrap}',
    '.ow-t td{padding:9px 12px;border-top:1px solid var(--line);white-space:nowrap;color:var(--text)}',
    '.ow-t td small{color:var(--muted);font-weight:600}',
    '.ow-t tr.ow-none td{color:var(--muted)}',
    '.ow-t tr[data-reg]{cursor:pointer}',
    '.ow-t tr.ow-det td{white-space:normal;background:var(--surface2)}',
    '.ow-t tfoot td{font-weight:900;border-top:2px solid var(--line)}',
    '.ow-stops{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:6px}',
    '.ow-stops span{font-size:.8rem;font-weight:700;padding:5px 10px;border-radius:10px;background:var(--leave-bg);color:var(--leave)}',
    '.ow-stops a,.ow-a a{color:var(--gold);font-weight:800;text-decoration:none;margin-left:6px}',
    '.ow-tl{position:relative;width:220px;height:12px;border-radius:6px;background:var(--surface2);overflow:hidden;border:1px solid var(--line)}',
    '.ow-tl i{position:absolute;top:0;bottom:0}.ow-tl .on{background:var(--active)}.ow-tl .st{background:var(--leave)}',
    '.ow-al{list-style:none;margin:0;padding:10px 14px 14px;display:grid;gap:8px}',
    '.ow-al li{display:grid;grid-template-columns:70px 1fr auto;gap:12px;align-items:center;padding:10px 14px;border-radius:14px;background:var(--surface2);border:1px solid var(--line);border-left:5px solid var(--k)}',
    '.ow-al .lv{font-size:.7rem;font-weight:900;text-transform:uppercase;letter-spacing:.06em;color:var(--k)}',
    '.ow-al b{display:block;color:var(--text)}.ow-al small{display:block;color:var(--muted);font-weight:600;margin-top:2px}',
    '.ow-al .ow-a{display:flex;gap:4px;white-space:nowrap}',
    '.ow-note{margin:0;padding:10px 16px 14px;color:var(--muted);font-size:.8rem;line-height:1.5}',
    '@media (max-width:760px){.ow-kpis{grid-template-columns:1fr 1fr}.ow-al li{grid-template-columns:1fr}.ow-tlc{display:none}}',
    '@media print{body *{visibility:hidden}#owReports,#owReports *{visibility:visible}#owReports{position:absolute;left:0;top:0;width:100%}#owReports .ow-tools{display:none}#owReports .ow-tw{max-height:none;overflow:visible}}'
  ].join('\n');
  document.head.appendChild(css);

  /* ---------- owner bar ---------- */
  var I = {
    map:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/></svg>',
    bell:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z"/><path d="M10 20a2 2 0 0 0 4 0"/></svg>',
    act:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4V3h6v1M9 10h6M9 14h6M9 18h3"/></svg>',
    rep:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M5 20V12M10 20V6M15 20v-9M20 20V9"/></svg>'
  };
  var main = document.querySelector('main.wrap'); if(!main) return;
  var bar = document.createElement('div'); bar.className = 'ow-bar'; bar.setAttribute('aria-label', 'Owner tools');
  bar.innerHTML = '<span class="ow-k">Owner</span>'+
    '<a class="ow-b" href="control">'+I.map+'Control Room</a>'+
    '<button class="ow-b" type="button" data-p="owAlerts" aria-pressed="false">'+I.bell+'Alerts <span class="ow-n" id="owN" hidden></span></button>'+
    '<button class="ow-b" type="button" data-p="owActivity" aria-pressed="false">'+I.act+'Activity Log</button>'+
    '<button class="ow-b" type="button" data-p="owReports" aria-pressed="false">'+I.rep+'Reports</button>'+
    '<a class="ow-b alt" href="gate" style="font-size:1.1rem;padding:7px 14px">&infin;</a>';
  var holder = document.createElement('div');
  holder.innerHTML =
    '<section class="panel ow-panel" id="owAlerts" hidden><div class="ph"><h3>Alerts</h3><div class="ow-tools"><span id="owAlSub" style="color:#cfe0c4;font-weight:700;font-size:.85rem"></span></div></div><ul class="ow-al" id="owAlList"></ul></section>'+
    '<section class="panel ow-panel" id="owActivity" hidden><div class="ph"><h3>Activity log</h3><div class="ow-tools"><button type="button" id="owPrev">‹</button><input type="date" id="owDay"><button type="button" id="owNext">›</button><button type="button" id="owToday">Today</button></div></div>'+
      '<div class="ow-kpis" id="owActK"></div><div class="ow-tw"><table class="ow-t"><thead><tr><th>Person</th><th>Bike</th><th>Started</th><th>Last moved</th><th>Moving</th><th>Stopped</th><th>Km</th><th>Stops</th><th class="ow-tlc">Day (6 am – 10 pm)</th></tr></thead><tbody id="owActR"></tbody></table></div>'+
      '<p class="ow-note">Worked out from one position every 5 minutes, so times and km are approximate. Tap a person for their stops.</p></section>'+
    '<section class="panel ow-panel" id="owReports" hidden><div class="ph"><h3>Reports</h3><div class="ow-tools" id="owRanges"><button type="button" data-r="0">Today</button><button type="button" data-r="1">Yesterday</button><button type="button" data-r="7">Last 7 days</button><button type="button" data-r="30">Last 30 days</button><button type="button" id="owCsv">Download CSV</button><button type="button" id="owPrint">Print</button></div></div>'+
      '<div class="ow-kpis" id="owRepK"></div><div class="ow-tw"><table class="ow-t"><thead><tr><th>Person</th><th>Section</th><th>Bike</th><th>Days moved</th><th>Total km</th><th>Km per day</th><th>Moving time</th><th>Usual start</th><th>Top speed</th></tr></thead><tbody id="owRepR"></tbody><tfoot id="owRepF"></tfoot></table></div>'+
      '<p class="ow-note" id="owRepNote"></p></section>';
  main.insertBefore(holder, main.firstChild);
  main.insertBefore(bar, holder);
  var $ = function(id){ return document.getElementById(id); };

  bar.addEventListener('click', function(e){
    var b = e.target.closest('[data-p]'); if(!b) return;
    var id = b.getAttribute('data-p'), open = $(id).hidden;
    ['owAlerts','owActivity','owReports'].forEach(function(p){ $(p).hidden = true; });
    bar.querySelectorAll('[data-p]').forEach(function(x){ x.setAttribute('aria-pressed','false'); });
    if(open){ $(id).hidden = false; b.setAttribute('aria-pressed','true'); if(id === 'owReports' && !rep) loadReport(); $(id).scrollIntoView({behavior:'smooth', block:'start'}); }
  });

  /* ---------- data ---------- */
  var fleet = null, today = pkDay(Date.now()), day = today, act = null, actToday = null, openReg = null, rangeDays = 7, rep = null;
  function loadAll(){
    today = pkDay(Date.now());
    return Promise.all([get('api/fleet.json'), get('api/activity.json?date='+today), day !== today ? get('api/activity.json?date='+day) : null]).then(function(r){
      fleet = r[0] && r[0].available ? r[0] : null; actToday = r[1]; act = day === today ? r[1] : r[2];
      drawAlerts(); drawActivity();
    });
  }

  /* ---------- alerts ---------- */
  var LV = {high:{lb:'Urgent',k:'#e5484d',o:0}, med:{lb:'Check',k:'#f5a524',o:1}, info:{lb:'Note',k:'#5b9bd5',o:2}};
  function drawAlerts(){
    var A = [], nowMin = mod(Date.now()/1000);
    function add(lv, t, d, reg, tel){ A.push({lv:lv, t:t, d:d, reg:reg, tel:tel}); }
    if(fleet){
      if(fleet.stale) add('high', 'Live data is out of date', 'The last successful sync with the tracking portal was ' + ago(fleet.fetchedAt) + '.');
      if(fleet.authDaysLeft != null && fleet.authDaysLeft <= 7) add(fleet.authDaysLeft <= 2 ? 'high' : 'med', 'Portal login runs out in ' + fleet.authDaysLeft + ' day' + (fleet.authDaysLeft === 1 ? '' : 's'), 'Renew the portal token before then, or the numbers stop updating.');
      var weak = [];
      fleet.vehicles.forEach(function(v){
        var p = person(v.reg), r = p.r, s = actToday && actToday.vehicles ? actToday.vehicles[v.reg] : null;
        if(v.state === 'none' && r && r.status === 'active') add('med', 'Tracker offline: ' + p.name + ' (' + v.reg + ')', (v.reportedAt ? 'Last report ' + ago(v.reportedAt) : 'No report on record') + '. ' + (r.designation || ''), v.reg, r.contact);
        if(r && /leave|absent|suspended/.test(r.status) && ((s && s.movingMin > 0) || v.state === 'moving')) add('high', 'Bike moving while ' + DUTY[r.status].toLowerCase() + ': ' + p.name, v.reg + (s ? ' moved ' + s.km.toFixed(1) + ' km today.' : ' is moving now.'), v.reg, r.contact);
        if(r && r.status === 'parked' && s && s.km >= 1) add('med', 'Pool bike in use: ' + v.reg, 'Moved ' + s.km.toFixed(1) + ' km today.', v.reg);
        if(s && s.maxSpeed != null && s.maxSpeed >= 80) add('med', 'High speed: ' + p.name + ' (' + v.reg + ')', 'Top speed today ' + Math.round(s.maxSpeed) + ' km/h.', v.reg, r && r.contact);
        if(s && s.firstMove != null && (mod(s.firstMove) < 6*60 || mod(s.lastMove) >= 21*60)) add('info', 'Moved outside working hours: ' + p.name, v.reg + ' moved between ' + pkt(s.firstMove) + ' and ' + pkt(s.lastMove) + ' today.', v.reg);
        if(nowMin >= 13*60 && actToday && r && r.status === 'active' && !r.sec.notPosts && r.sec.id !== 'office' && v.state !== 'none' && !(s && s.movingMin > 0)) add('info', 'No movement today: ' + p.name, (r.designation || r.sec.label) + ', ' + v.reg + '.', v.reg, r.contact);
        if(v.signal === 'weak' && v.state !== 'none') weak.push(v.reg);
      });
      if(weak.length) add('info', weak.length + ' bike' + (weak.length === 1 ? '' : 's') + ' on weak mobile signal', weak.join(', ') + '.');
    } else add('high', 'Live data is not available', 'The tracking feed could not be read just now.');
    A.sort(function(a,b){ return LV[a.lv].o - LV[b.lv].o; });
    var n = A.filter(function(a){ return a.lv !== 'info'; }).length;
    $('owN').textContent = n; $('owN').hidden = !n;
    $('owAlSub').textContent = A.length ? n + ' to check, ' + (A.length - n) + (A.length - n === 1 ? ' note' : ' notes') : '';
    $('owAlList').innerHTML = A.length ? A.map(function(a){ var tel = a.tel ? String(a.tel).replace(/[^\d+]/g,'') : '';
      return '<li style="--k:'+LV[a.lv].k+'"><span class="lv">'+LV[a.lv].lb+'</span><div><b>'+esc(a.t)+'</b><small>'+esc(a.d)+'</small></div><span class="ow-a">'+
        (a.reg ? '<a href="control?reg='+encodeURIComponent(a.reg)+'">Map</a>' : '')+(tel ? '<a href="tel:'+esc(tel)+'">Call</a>' : '')+'</span></li>'; }).join('')
      : '<li style="--k:#5fd38f"><span class="lv">All clear</span><div><b>Nothing needs attention.</b></div><span></span></li>';
  }


  /* street address for stops (owner-only lookup, cached on the server and on this device) */
  var placeQ = Promise.resolve();
  function fillPlaces(root){
    root.querySelectorAll('[data-addr]').forEach(function(el){
      var k = el.getAttribute('data-addr'), c = null; try{ c = localStorage.getItem('place:' + k); }catch(e){}
      if(c){ el.textContent = ' · ' + c; return; }
      var p = k.split(',');
      placeQ = placeQ.then(function(){ return fetch('api/place.json?lat=' + p[0] + '&lon=' + p[1], {credentials:'same-origin'}).then(function(r){ return r.ok ? r.json() : null; })
        .then(function(j){ if(j && j.place){ el.textContent = ' · ' + j.place; try{ localStorage.setItem('place:' + k, j.place); }catch(e){} } }).catch(function(){}); });
    });
  }
  /* ---------- activity ---------- */
  $('owDay').max = today; $('owDay').min = addDays(today, -30);
  function timeline(s){
    var A = 360, W = 960, x = function(m){ return Math.max(0, Math.min(100, (m - A)/W*100)); }, h = '';
    if(s.firstMove != null){ var a = x(mod(s.firstMove)), b = x(mod(s.lastMove)); h += '<i class="on" style="left:'+a+'%;width:'+Math.max(1,b-a)+'%"></i>'; }
    (s.stops||[]).forEach(function(st){ var a = x(mod(st.from)), b = x(mod(st.to)); h += '<i class="st" style="left:'+a+'%;width:'+Math.max(.8,b-a)+'%"></i>'; });
    return '<div class="ow-tl">'+h+'</div>';
  }
  function drawActivity(){
    $('owDay').value = day; $('owNext').disabled = day >= today;
    if(!act){ $('owActR').innerHTML = '<tr><td colspan="9" class="empty">No activity data for this day.</td></tr>'; $('owActK').innerHTML = ''; return; }
    var regs = {}; Object.keys(act.vehicles||{}).forEach(function(r){ regs[r] = 1; }); rows.forEach(function(r){ if(r.vehicle) regs[r.vehicle] = 1; });
    var list = Object.keys(regs).map(function(reg){ return {reg:reg, s:(act.vehicles||{})[reg] || null, p:person(reg)}; });
    var moved = list.filter(function(x){ return x.s && x.s.movingMin > 0; });
    list.sort(function(a,b){ var am = a.s && a.s.firstMove != null, bm = b.s && b.s.firstMove != null; if(am !== bm) return am ? -1 : 1; return am ? a.s.firstMove - b.s.firstMove : a.p.name.localeCompare(b.p.name); });
    var km = moved.reduce(function(t,x){ return t + x.s.km; }, 0), first = moved.length ? Math.min.apply(null, moved.map(function(x){ return x.s.firstMove; })) : null;
    var far = moved.slice().sort(function(a,b){ return b.s.km - a.s.km; })[0];
    $('owActK').innerHTML = '<div><b>'+moved.length+' / '+list.length+'</b><span>bikes that moved</span></div><div><b>'+km.toFixed(1)+' km</b><span>travelled in total</span></div>'+
      '<div><b>'+(first != null ? esc(pkt(first)) : '—')+'</b><span>earliest start</span></div><div><b>'+(far ? far.s.km.toFixed(1)+' km' : '—')+'</b><span>'+(far ? 'farthest: '+esc(far.p.name) : 'farthest distance')+'</span></div>';
    $('owActR').innerHTML = list.map(function(x){
      var s = x.s, row = '<tr data-reg="'+esc(x.reg)+'" class="'+(!s || !s.movingMin ? 'ow-none' : '')+'"><td><b>'+esc(x.p.name)+'</b><br><small>'+esc(x.p.post)+'</small></td><td><b>'+esc(x.reg)+'</b></td>'+
        '<td>'+(s && s.firstMove != null ? esc(pkt(s.firstMove)) : '—')+'</td><td>'+(s && s.lastMove != null ? esc(pkt(s.lastMove)) : '—')+'</td><td>'+(s ? hm(s.movingMin) : '—')+'</td><td>'+(s ? hm(s.stoppedMin) : '—')+'</td>'+
        '<td><b>'+(s ? s.km.toFixed(1) : '—')+'</b></td><td>'+(s ? s.stops.length : '—')+'</td><td class="ow-tlc">'+(s ? timeline(s) : '<small>no reports</small>')+'</td></tr>';
      if(openReg === x.reg && s) row += '<tr class="ow-det"><td colspan="9"><div class="ow-stops">'+(s.stops.length ? s.stops.map(function(st){
          return '<span>Stopped '+esc(pkt(st.from))+' – '+esc(pkt(st.to))+' ('+hm(st.min)+')<em data-addr="'+st.lat.toFixed(3)+','+st.lon.toFixed(3)+'" style="font-style:normal"></em><a href="control?reg='+encodeURIComponent(x.reg)+'&date='+day+'&at='+st.from+'">on the map</a></span>'; }).join('') : '<span>No stops of 10 minutes or more.</span>')+
        '</div><small>'+s.points+(s.points === 1 ? ' report' : ' reports')+(s.maxSpeed != null ? ', top speed '+Math.round(s.maxSpeed)+' km/h' : '')+'.'+(true ? ' <a href="control?reg='+encodeURIComponent(x.reg)+'&date='+day+'" style="color:var(--gold);font-weight:800">Route on the map</a>' : '')+'</small></td></tr>';
      return row;
    }).join('');
    fillPlaces($('owActR'));
  }
  $('owActR').addEventListener('click', function(e){ var tr = e.target.closest('tr[data-reg]'); if(!tr || e.target.closest('a')) return; var r = tr.getAttribute('data-reg'); openReg = openReg === r ? null : r; drawActivity(); });
  function goDay(d){ if(d > today || d < addDays(today, -30)) return; day = d; openReg = null; get('api/activity.json?date='+d).then(function(j){ act = j; drawActivity(); }); }
  $('owPrev').onclick = function(){ goDay(addDays(day, -1)); }; $('owNext').onclick = function(){ goDay(addDays(day, 1)); };
  $('owToday').onclick = function(){ goDay(today); }; $('owDay').onchange = function(){ if(this.value) goDay(this.value); };

  /* ---------- reports ---------- */
  function loadReport(){
    var to = today, from = rangeDays === 0 ? today : rangeDays === 1 ? addDays(today, -1) : addDays(today, -(rangeDays-1)); if(rangeDays === 1) to = from;
    return get('api/report.json?from='+from+'&to='+to).then(function(j){ rep = j; drawReport(); });
  }
  function repRows(){
    var regs = {}; Object.keys(rep.vehicles||{}).forEach(function(r){ regs[r] = 1; }); rows.forEach(function(r){ if(r.vehicle) regs[r.vehicle] = 1; });
    return Object.keys(regs).map(function(reg){
      var days = (rep.vehicles||{})[reg] || {}, ds = Object.keys(days), moved = ds.filter(function(d){ return days[d].movingMin > 0; });
      var starts = moved.map(function(d){ return mod(days[d].firstMove); }).sort(function(a,b){ return a-b; });
      return {reg:reg, p:person(reg), days:days, moved:moved.length, km:ds.reduce(function(t,d){ return t + days[d].km; }, 0), mv:ds.reduce(function(t,d){ return t + days[d].movingMin; }, 0),
        start:starts.length ? starts[Math.floor(starts.length/2)] : null, top:ds.reduce(function(t,d){ return days[d].maxSpeed != null ? Math.max(t == null ? 0 : t, days[d].maxSpeed) : t; }, null)};
    }).sort(function(a,b){ return b.km - a.km || a.p.name.localeCompare(b.p.name); });
  }
  function drawReport(){
    $('owRanges').querySelectorAll('[data-r]').forEach(function(b){ b.setAttribute('aria-pressed', +b.getAttribute('data-r') === rangeDays); });
    if(!rep){ $('owRepR').innerHTML = '<tr><td colspan="9" class="empty">The report could not be loaded.</td></tr>'; $('owRepF').innerHTML = ''; $('owRepK').innerHTML = ''; return; }
    var list = repRows(), rec = rep.recordedDays.length, tk = list.reduce(function(t,x){ return t + x.km; }, 0), tm = list.reduce(function(t,x){ return t + x.mv; }, 0);
    var idle = list.filter(function(x){ return x.p.r && !x.p.r.sec.notPosts && x.p.r.status === 'active' && rec && x.moved === 0; }).length;
    $('owRepK').innerHTML = '<div><b>'+tk.toFixed(1)+' km</b><span>travelled in total</span></div><div><b>'+hm(tm)+'</b><span>moving time in total</span></div><div><b>'+rec+' / '+rep.days.length+'</b><span>days with recorded data</span></div><div><b>'+idle+'</b><span>active staff with no movement</span></div>';
    $('owRepR').innerHTML = list.map(function(x){
      return '<tr><td><b>'+esc(x.p.name)+'</b><br><small>'+esc(x.p.post)+'</small></td><td>'+esc(x.p.sec)+'</td><td><b>'+esc(x.reg)+'</b></td><td>'+x.moved+(rec ? ' / '+rec : '')+'</td><td><b>'+x.km.toFixed(1)+'</b></td>'+
        '<td>'+(rec ? (x.km/rec).toFixed(1) : '—')+'</td><td>'+hm(x.mv)+'</td><td>'+clockMin(x.start)+'</td><td>'+(x.top != null ? Math.round(x.top)+' km/h' : '—')+'</td></tr>';
    }).join('');
    $('owRepF').innerHTML = '<tr><td>Total</td><td></td><td></td><td></td><td>'+tk.toFixed(1)+'</td><td></td><td>'+hm(tm)+'</td><td></td><td></td></tr>';
    $('owRepNote').textContent = 'Period ' + rep.from + ' to ' + rep.to + ' (Pakistan dates). Data has been recorded since the Control Room went live, and is kept 31 days.';
  }
  $('owRanges').addEventListener('click', function(e){ var b = e.target.closest('[data-r]'); if(!b) return; rangeDays = +b.getAttribute('data-r'); loadReport(); });
  $('owPrint').onclick = function(){ window.print(); };
  $('owCsv').onclick = function(){
    if(!rep) return;
    var L = [['Date','Bike','Name','Post','Section','Km','Moving minutes','Stopped minutes','First move (PKT)','Last move (PKT)','Reports','Top speed km/h']];
    repRows().forEach(function(x){ rep.days.forEach(function(d){ var s = x.days[d]; if(!s) return;
      L.push([d, x.reg, x.p.name, x.p.post, x.p.sec, s.km, s.movingMin, s.stoppedMin, s.firstMove != null ? pkt(s.firstMove) : '', s.lastMove != null ? pkt(s.lastMove) : '', s.points, s.maxSpeed != null ? Math.round(s.maxSpeed) : '']); }); });
    var csv = L.map(function(r){ return r.map(function(v){ v = String(v == null ? '' : v); return /[",\n]/.test(v) ? '"'+v.replace(/"/g,'""')+'"' : v; }).join(','); }).join('\r\n');
    var a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['﻿'+csv], {type:'text/csv'})); a.download = 'dc-forest-activity-'+rep.from+'-to-'+rep.to+'.csv';
    document.body.appendChild(a); a.click(); setTimeout(function(){ URL.revokeObjectURL(a.href); a.remove(); }, 500);
  };

  loadAll().then(function(){   // opened as /#alerts, /#activity or /#reports: show that panel
    var want = {'#alerts':'owAlerts', '#activity':'owActivity', '#reports':'owReports'}[location.hash];
    if(want){ var b = bar.querySelector('[data-p="'+want+'"]'); if(b) b.click(); }
  });
  setInterval(function(){ if(!document.hidden) loadAll(); }, 60000);
})();
