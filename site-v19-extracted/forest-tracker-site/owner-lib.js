/* Shared helpers for the owner screens (Today, person page): staff list, live feed, activity, alert rules,
   addresses and the one colour rule. Served only to the owner and reviewers. Exposes window.DCF. */
(function(){
  'use strict';
  var STATES = {   // one colour rule everywhere: red is kept for alerts and problems only
    moving:{lb:'Moving',  c:'#16a34a'},
    idle:  {lb:'Idle',    c:'#d97706'},
    stop:  {lb:'Stopped', c:'#64748b'},
    none:  {lb:'Offline', c:'#9ca3af'}
  };
  var ALERT = {high:{lb:'Urgent', c:'#dc2626', o:0}, med:{lb:'Check', c:'#d97706', o:1}, info:{lb:'Note', c:'#2563eb', o:2}};
  var DUTY = {active:'Active', field:'On field duty', leave:'On leave', absent:'Absent', suspended:'Suspended', parked:'Pool', inuse:'In use', vacant:'Vacant'};

  function esc(s){ return String(s == null ? '' : s).replace(/[&<>"']/g, function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); }
  function short(n){ return String(n||'').replace(/^(Mr|Mrs|Ms|Dr)\.?\s+/i,''); }
  function initials(n){ return short(n).split(/\s+/).filter(Boolean).slice(0,2).map(function(w){ return w[0]; }).join('').toUpperCase() || '?'; }
  function ago(iso){ if(!iso) return null; var s = (Date.now() - Date.parse(iso))/1000;
    return s < 90 ? 'just now' : s < 3600 ? Math.round(s/60)+' min ago' : s < 86400 ? Math.round(s/3600)+' h ago' : Math.round(s/86400)+' days ago'; }
  function pkt(sec){ return sec == null ? null : new Date(sec*1000).toLocaleTimeString('en-US', {timeZone:'Asia/Karachi', hour:'numeric', minute:'2-digit'}); }
  function hm(min){ if(min == null) return '—'; var h = Math.floor(min/60), m = min % 60; return h ? h+' h '+String(m).padStart(2,'0')+' m' : m+' min'; }
  function pkDay(ms){ return new Date((ms == null ? Date.now() : ms) + 5*3600000).toISOString().slice(0,10); }
  function addDays(d, n){ return new Date(Date.parse(d+'T00:00:00Z') + n*86400000).toISOString().slice(0,10); }
  function mod(sec){ var d = new Date(sec*1000 + 5*3600000); return d.getUTCHours()*60 + d.getUTCMinutes(); }
  function get(url){ return fetch(url, {cache:'no-store', credentials:'same-origin'}).then(function(r){
    if(r.status === 401 || r.status === 403){ location.href = 'gate'; throw new Error('signed-out'); } return r.ok ? r.json() : null; }); }

  /* staff list (small file, not the whole public page) */
  var staff = null;
  function loadStaff(){
    if(staff) return Promise.resolve(staff);
    return Promise.all([get('api/staff.json'), get('staff/photos.json').catch(function(){ return {}; })]).then(function(r){
      var d = r[0] || {sections:[]}, photos = r[1] || {}, rows = [], byReg = {};
      d.sections.forEach(function(s){ s.rows.forEach(function(row){
        var x = Object.assign({}, row, {sec:s, short:short(row.name), photo: row.name && photos[short(row.name)] ? 'staff/' + photos[short(row.name)] : null});
        rows.push(x); if(row.vehicle && !byReg[row.vehicle]) byReg[row.vehicle] = x; }); });
      return (staff = {data:d, rows:rows, byReg:byReg});
    });
  }
  function person(reg){
    var r = staff && staff.byReg[reg];
    return {reg:reg, r:r, name: r && r.name ? short(r.name) : (r && r.status === 'parked' ? 'Pool bike' : r ? 'Unassigned' : 'Not on staff list'),
      post: r ? (r.designation || r.sec.label) : '', sec: r ? r.sec.label : '', photo: r && r.photo, contact: r && r.contact};
  }
  function avatar(p, size){
    size = size || 40;
    return p.photo ? '<img class="dcf-av" src="'+esc(p.photo)+'" alt="" style="width:'+size+'px;height:'+size+'px">'
      : '<span class="dcf-av" style="width:'+size+'px;height:'+size+'px;font-size:'+Math.round(size*.36)+'px">'+esc(initials(p.name))+'</span>';
  }
  function tel(c){ return c ? String(c).replace(/[^\d+]/g,'') : ''; }
  function wa(c){ var d = tel(c).replace(/\D/g,''); return /^03\d{9}$/.test(d) ? '92' + d.slice(1) : /^923\d{9}$/.test(d) ? d : null; }

  /* street address for a point (owner-only lookup, cached on the server and on this device) */
  var placeMem = {}, placeQ = Promise.resolve();
  function placeOf(lat, lon){
    var k = (+lat).toFixed(3) + ',' + (+lon).toFixed(3);
    if(placeMem[k]) return placeMem[k];
    try{ var c = localStorage.getItem('place:' + k); if(c) return (placeMem[k] = Promise.resolve(c)); }catch(e){}
    return (placeMem[k] = placeQ = placeQ.then(function(){
      return fetch('api/place.json?lat=' + lat + '&lon=' + lon, {credentials:'same-origin'}).then(function(r){ return r.ok ? r.json() : null; })
        .then(function(j){ var p = j && j.place; if(p){ try{ localStorage.setItem('place:' + k, p); }catch(e){} } return p || (+lat).toFixed(5) + ', ' + (+lon).toFixed(5); })
        .catch(function(){ return (+lat).toFixed(5) + ', ' + (+lon).toFixed(5); });
    }));
  }
  function fillPlaces(root){
    root.querySelectorAll('[data-place]').forEach(function(el){ var p = el.getAttribute('data-place').split(','); placeOf(+p[0], +p[1]).then(function(a){ el.textContent = a; }); });
  }

  /* alert rules (same as the owner bar on the classic page) */
  function alerts(fleet, act){
    var A = [], nowMin = mod(Date.now()/1000);
    function add(lv, t, d, reg){ var p = reg ? person(reg) : null; A.push({lv:lv, t:t, d:d, reg:reg, tel: p && tel(p.contact)}); }
    if(!fleet){ add('high', 'Live data is not available', 'The tracking feed could not be read just now.'); return A; }
    if(fleet.stale) add('high', 'Live data is out of date', 'Last successful sync ' + ago(fleet.fetchedAt) + '.');
    if(fleet.authDaysLeft != null && fleet.authDaysLeft <= 7) add(fleet.authDaysLeft <= 2 ? 'high' : 'med', 'Portal login runs out in ' + fleet.authDaysLeft + ' day' + (fleet.authDaysLeft === 1 ? '' : 's'), 'Renew it before then, or the numbers stop updating.');
    var weak = [];
    fleet.vehicles.forEach(function(v){
      var p = person(v.reg), r = p.r, s = act && act.vehicles ? act.vehicles[v.reg] : null;
      if(v.state === 'none' && r && r.status === 'active') add('med', 'Tracker offline: ' + p.name, v.reg + ' · ' + (v.reportedAt ? 'last report ' + ago(v.reportedAt) : 'no report on record'), v.reg);
      if(r && /leave|absent|suspended/.test(r.status) && ((s && s.movingMin > 0) || v.state === 'moving')) add('high', 'Moving while ' + DUTY[r.status].toLowerCase() + ': ' + p.name, v.reg + (s ? ' · ' + s.km.toFixed(1) + ' km today' : ' · moving now'), v.reg);
      if(r && r.status === 'parked' && s && s.km >= 1) add('med', 'Pool bike in use: ' + v.reg, s.km.toFixed(1) + ' km today', v.reg);
      if(s && s.maxSpeed != null && s.maxSpeed >= 80) add('med', 'High speed: ' + p.name, v.reg + ' · top ' + Math.round(s.maxSpeed) + ' km/h', v.reg);
      if(s && s.firstMove != null && (mod(s.firstMove) < 6*60 || mod(s.lastMove) >= 21*60)) add('info', 'Outside working hours: ' + p.name, v.reg + ' · ' + pkt(s.firstMove) + ' – ' + pkt(s.lastMove), v.reg);
      if(nowMin >= 13*60 && act && r && r.status === 'active' && !r.sec.notPosts && r.sec.id !== 'office' && v.state !== 'none' && !(s && s.movingMin > 0)) add('info', 'No movement today: ' + p.name, (r.designation || r.sec.label) + ' · ' + v.reg, v.reg);
      if(v.signal === 'weak' && v.state !== 'none') weak.push(v.reg);
    });
    if(weak.length) add('info', weak.length + ' on weak mobile signal', weak.join(', '));
    A.sort(function(a,b){ return ALERT[a.lv].o - ALERT[b.lv].o; });
    return A;
  }

  /* shared look for avatars */
  var st = document.createElement('style');
  st.textContent = '.dcf-av{display:inline-grid;place-items:center;border-radius:50%;object-fit:cover;object-position:50% 15%;background:#d9ebdf;color:#1f6b45;font-weight:800;flex:none}';
  document.head.appendChild(st);

  window.DCF = {STATES:STATES, ALERT:ALERT, DUTY:DUTY, esc:esc, short:short, initials:initials, ago:ago, pkt:pkt, hm:hm, pkDay:pkDay, addDays:addDays, mod:mod,
    get:get, loadStaff:loadStaff, person:person, avatar:avatar, tel:tel, wa:wa, placeOf:placeOf, fillPlaces:fillPlaces, alerts:alerts,
    staff:function(){ return staff; }};
})();
