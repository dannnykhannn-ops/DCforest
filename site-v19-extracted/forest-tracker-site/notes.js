/* Notes pinned to a spot on a page, for the owner and reviewers. Added by the server only to owner and
   reviewer pages; the notes themselves come from /api/notes.json, which nobody else can read.
   Add note -> tap a spot -> write -> a numbered pin stays on that spot for everyone with access. */
(function(){
  'use strict';
  if(window.__notesLoaded) return; window.__notesLoaded = true;
  var Z = 2147483000, me = null, notes = [], adding = false, showPins = true, showDone = false, openId = null;
  var skin = document.documentElement.getAttribute('data-skin') === 'new' ? 'new' : 'classic';
  var pageKey = (location.pathname.replace(/\.html$/, '').replace(/\/index$/, '/') || '/');
  var PAGES = {'/':'Main page', '/classic':'Main page', '/control':'Control Room', '/dashboard':'Dashboard'};
  function pageName(p){ return PAGES[p] || p; }
  function esc(s){ return String(s == null ? '' : s).replace(/[&<>"']/g, function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); }
  function when(iso){ var d = new Date(iso); return d.toLocaleDateString('en-GB',{day:'numeric',month:'short'}) + ', ' + d.toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'}); }
  function samePage(n){ return (n.page === pageKey || (n.page === '/classic' && pageKey === '/') || (n.page === '/' && pageKey === '/classic')) && n.skin === skin; }

  /* ---------- styles ---------- */
  var st = document.createElement('style');
  st.textContent = [
    '.nt-dock{position:fixed;right:10px;top:calc(10px + env(safe-area-inset-top));z-index:'+Z+';display:flex;flex-direction:column;gap:6px;align-items:stretch}',
    '@media (min-width:761px){ .nt-dock{top:68px} }',
    'body:has(.hdr) .nt-dock{top:calc(70px + env(safe-area-inset-top))}',
    '.nt-fab,.nt-pinbtn{display:flex;align-items:center;justify-content:center;gap:6px;padding:7px 11px;border-radius:99px;border:2px solid #fff;font:800 12.5px Figtree,system-ui,sans-serif;cursor:pointer!important;box-shadow:0 6px 16px rgba(0,0,0,.35);white-space:nowrap}',
    '.nt-fab{background:linear-gradient(135deg,#7c3aed,#db2777);color:#fff}',
    '.nt-pinbtn{background:#fff;color:#4c1d95}.nt-pinbtn i{font-style:normal;font-size:16px}',
    '.nt-fab b{min-width:18px;height:18px;font-size:11px}',
    '.nt-pinbtn .sw{width:30px;height:18px;border-radius:99px;background:#d1d5db;position:relative;transition:background .2s}',
    '.nt-pinbtn .sw::after{content:"";position:absolute;top:2px;left:2px;width:14px;height:14px;border-radius:50%;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,.3);transition:left .2s}',
    '.nt-pinbtn[aria-pressed="true"]{background:#db2777;color:#fff;animation:ntp 1.6s infinite}',
    '.nt-pinbtn[aria-pressed="true"] .sw{background:#fff}.nt-pinbtn[aria-pressed="true"] .sw::after{left:14px;background:#db2777}',
    '@keyframes ntp{50%{box-shadow:0 0 0 8px rgba(219,39,119,.25),0 10px 26px rgba(0,0,0,.35)}}',
    '.nt-frame{position:fixed;inset:0;z-index:'+(Z-3)+';pointer-events:none;box-shadow:inset 0 0 0 4px #db2777,inset 0 0 40px rgba(219,39,119,.35)}',
    '.nt-fab b{display:inline-grid;place-items:center;min-width:20px;height:20px;padding:0 6px;border-radius:99px;background:#fff;color:#7c3aed;font-size:12px}',

    '.nt-panel{position:fixed;right:10px;top:calc(96px + env(safe-area-inset-top));z-index:'+Z+';width:min(380px,calc(100vw - 28px));max-height:70vh;display:flex;flex-direction:column;',
    '  background:#fff;color:#14201a;border-radius:18px;box-shadow:0 20px 50px rgba(0,0,0,.4);font:14px/1.4 Figtree,system-ui,sans-serif;overflow:hidden}',
    '@media (min-width:761px){ .nt-panel{top:154px} }', 'body:has(.hdr) .nt-panel{top:calc(156px + env(safe-area-inset-top))}',
    '.nt-panel[hidden],.nt-pop[hidden],.nt-banner[hidden],.nt-frame[hidden]{display:none}',
    '.nt-h{display:flex;align-items:center;gap:8px;padding:12px 14px;background:linear-gradient(135deg,#7c3aed,#db2777);color:#fff}',
    '.nt-h b{flex:1;font-size:15px}.nt-h small{opacity:.85}',
    '.nt-x{border:0;background:rgba(255,255,255,.2);color:#fff;width:28px;height:28px;border-radius:50%;cursor:pointer;font-size:16px}',
    '.nt-tools{display:flex;flex-wrap:wrap;gap:6px;padding:10px 12px;border-bottom:1px solid #eee}',
    '.nt-b{border:1px solid #ddd;background:#fff;color:#14201a;border-radius:99px;padding:7px 12px;font:700 13px Figtree,system-ui,sans-serif;cursor:pointer}',
    '.nt-b.pri{background:#7c3aed;border-color:#7c3aed;color:#fff}.nt-b[aria-pressed="true"]{background:#ede9fe;border-color:#7c3aed;color:#5b21b6}',
    '.nt-b.dang{color:#b91c1c;border-color:#fecaca}',
    '.nt-list{overflow:auto;padding:8px 10px 12px}',
    '.nt-g{font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:#6b7280;font-weight:800;margin:10px 4px 6px}',
    '.nt-it{display:grid;grid-template-columns:26px 1fr;gap:10px;padding:9px;border-radius:12px;cursor:pointer}',
    '.nt-it:hover{background:#f5f3ff}.nt-it.done{opacity:.55}',
    '.nt-it p{margin:2px 0 0;white-space:pre-wrap;word-break:break-word}.nt-it small{color:#6b7280;font-size:12px}',
    '.nt-n{display:grid;place-items:center;width:26px;height:26px;border-radius:50% 50% 50% 4px;background:#7c3aed;color:#fff;font:900 12px Figtree,sans-serif;border:2px solid #fff;box-shadow:0 3px 8px rgba(0,0,0,.35)}',
    '.nt-n.done{background:#16a34a}.nt-n.mine{background:#db2777}',
    '.nt-pin{position:fixed;z-index:'+(Z-2)+';transform:translate(-4px,-22px);cursor:pointer;transition:transform .15s}',
    '.nt-pin:hover{transform:translate(-4px,-22px) scale(1.15)}',
    '.nt-pin.flash .nt-n{animation:ntf 1s 3}@keyframes ntf{50%{box-shadow:0 0 0 10px rgba(124,58,237,.35)}}',
    '.nt-pop{position:fixed;z-index:'+Z+';width:min(320px,calc(100vw - 24px));background:#fff;color:#14201a;border-radius:16px;box-shadow:0 18px 44px rgba(0,0,0,.4);padding:12px;font:14px/1.45 Figtree,system-ui,sans-serif}',
    '.nt-pop textarea{width:100%;min-height:90px;border:1px solid #ddd;border-radius:10px;padding:9px;font:inherit;resize:vertical;box-sizing:border-box}',
    '.nt-pop .acts{display:flex;gap:6px;justify-content:flex-end;margin-top:8px;flex-wrap:wrap}',
    '.nt-pop .meta{color:#6b7280;font-size:12px;margin-bottom:6px}.nt-pop .ctx{font-size:12px;color:#6b7280;font-style:italic;margin-top:4px}',
    '.nt-pop p{margin:0;white-space:pre-wrap;word-break:break-word}',
    '.nt-banner{position:fixed;top:calc(10px + env(safe-area-inset-top));left:10px;max-width:calc(100vw - 170px);pointer-events:none;z-index:'+Z+';background:#7c3aed;color:#fff;padding:7px 12px;border-radius:14px;font:800 12.5px/1.3 Figtree,system-ui,sans-serif;box-shadow:0 8px 20px rgba(0,0,0,.35)}',
    '@media (min-width:761px){ .nt-banner{top:68px;left:auto;right:160px} }', 'body:has(.hdr) .nt-banner{top:calc(70px + env(safe-area-inset-top))}',
    '.nt-banner button{border:0;background:rgba(255,255,255,.25);color:#fff;border-radius:99px;padding:5px 10px;font:inherit;cursor:pointer}',
    'html.nt-adding, html.nt-adding *{cursor:url("data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 width=%2732%27 height=%2740%27 viewBox=%270 0 32 40%27%3E%3Cpath d=%27M16 39s-13-12-13-23a13 13 0 0 1 26 0c0 11-13 23-13 23z%27 fill=%27%23db2777%27 stroke=%27white%27 stroke-width=%272.5%27/%3E%3Ccircle cx=%2716%27 cy=%2716%27 r=%275%27 fill=%27white%27/%3E%3C/svg%3E") 16 39, crosshair!important}',
    '.nt-mark{position:fixed;z-index:'+(Z-1)+';width:18px;height:18px;margin:-9px 0 0 -9px;border-radius:50%;background:#db2777;border:3px solid #fff;box-shadow:0 0 0 6px rgba(219,39,119,.3)}',
    '@media print{.nt-dock,.nt-frame,.nt-fab,.nt-panel,.nt-pin,.nt-pop,.nt-banner,.nt-mark{display:none!important}}'
  ].join('\n');
  document.head.appendChild(st);

  /* ---------- UI ---------- */
  function el(html){ var d = document.createElement('div'); d.innerHTML = html.trim(); return d.firstChild; }
  var dock = el('<div class="nt-dock"><button class="nt-pinbtn" type="button" aria-pressed="false" title="Turn on, then tap anywhere to pin a note there"><i>📍</i><span class="lb">Pin: OFF</span><span class="sw"></span></button>'+
    '<button class="nt-fab" type="button" aria-label="Notes">✎ Notes <b id="ntCount">0</b></button></div>');
  var fab = dock.querySelector('.nt-fab'), pinBtn = dock.querySelector('.nt-pinbtn');
  var frame = el('<div class="nt-frame" hidden></div>');
  var panel = el('<section class="nt-panel" hidden aria-label="Notes"><div class="nt-h"><b>Notes</b><small id="ntWho"></small><button class="nt-x" type="button" aria-label="Close">×</button></div>'+
    '<div class="nt-tools"><button class="nt-b pri" type="button" id="ntAdd">📍 Turn on Pin note</button><button class="nt-b" type="button" id="ntPins" aria-pressed="true">Pins on page</button><button class="nt-b" type="button" id="ntDone" aria-pressed="false">Show done</button></div>'+
    '<div class="nt-list" id="ntList"></div></section>');
  var pop = el('<div class="nt-pop" hidden></div>');
  var banner = el('<div class="nt-banner" hidden>📍 Pin is ON · tap any spot to leave a note</div>');
  var pinLayer = document.createElement('div');
  [pinLayer, frame, dock, panel, pop, banner].forEach(function(n){ document.body.appendChild(n); });
  pinBtn.onclick = function(){ adding ? stopAdd() : startAdd(); };
  var $ = function(id){ return document.getElementById(id); };
  fab.onclick = function(){ panel.hidden = !panel.hidden; pop.hidden = true; draw(); };
  panel.querySelector('.nt-x').onclick = function(){ panel.hidden = true; };
  $('ntAdd').onclick = function(){ startAdd(); };
  $('ntPins').onclick = function(){ showPins = !showPins; this.setAttribute('aria-pressed', showPins); placePins(); };
  $('ntDone').onclick = function(){ showDone = !showDone; this.setAttribute('aria-pressed', showDone); draw(); };


  /* ---------- where a note points: the nearest element with an id, plus the spot inside it ---------- */
  function ours(n){ return n && n.closest && n.closest('.nt-dock,.nt-panel,.nt-pop,.nt-pin,.nt-mark'); }
  function anchorFor(target){
    var a = target;
    while(a && a !== document.body && !(a.id && document.querySelectorAll('#' + CSS.escape(a.id)).length === 1)) a = a.parentElement;
    return a && a !== document.body ? a : null;
  }
  function contextFor(target){
    var t = (target.closest('h1,h2,h3,button,a,th,td,li,label,.card,.panel,.bdg,.row,.st,.ph,.veh,.kv') || target).innerText || '';
    return t.replace(/\s+/g, ' ').trim().slice(0, 60);
  }
  function spotOf(n){
    var a = n.anchor ? document.getElementById(n.anchor) : null;
    if(a){ var r = a.getBoundingClientRect(); if(r.width || r.height) return {x:r.left + n.fx * r.width, y:r.top + n.fy * r.height, ok:true}; }
    if(n.px == null || n.py == null) return null;
    var de = document.documentElement;
    return {x:n.px * de.scrollWidth - window.scrollX, y:n.py - window.scrollY, ok:false};
  }

  /* ---------- pin mode: ON until turned off; every tap on the page opens a note box at that spot ---------- */
  var mark = null, down = null;
  function startAdd(){
    adding = true; panel.hidden = true; pop.hidden = true; banner.hidden = false; frame.hidden = false;
    document.documentElement.classList.add('nt-adding');
    pinBtn.setAttribute('aria-pressed', 'true'); pinBtn.querySelector('.lb').textContent = 'Pin: ON';
  }
  function stopAdd(){
    adding = false; banner.hidden = true; frame.hidden = true; pop.hidden = true;
    document.documentElement.classList.remove('nt-adding');
    pinBtn.setAttribute('aria-pressed', 'false'); pinBtn.querySelector('.lb').textContent = 'Pin: OFF';
    if(mark){ mark.remove(); mark = null; }
  }
  function clearDraft(){ pop.hidden = true; if(mark){ mark.remove(); mark = null; } }
  /* While pin mode is on, taps go to the notes tool, not to the page (scrolling still works). */
  function block(e){ if(adding && !ours(e.target)){ e.preventDefault(); e.stopPropagation(); } }
  ['mousedown','mouseup','click','dblclick','contextmenu'].forEach(function(t){ document.addEventListener(t, block, true); });
  document.addEventListener('pointerdown', function(e){
    if(!adding || ours(e.target)) return;
    down = {x:e.clientX, y:e.clientY, id:e.pointerId};
    if(e.pointerType === 'mouse'){ e.preventDefault(); } e.stopPropagation();
  }, true);
  document.addEventListener('pointercancel', function(){ down = null; }, true);
  document.addEventListener('pointerup', function(e){
    if(!adding || ours(e.target)) return;
    e.stopPropagation();
    if(!down || Math.abs(e.clientX - down.x) > 10 || Math.abs(e.clientY - down.y) > 10){ down = null; return; }   // that was a scroll, not a tap
    down = null;
    if(!pop.hidden){ clearDraft(); return; }      // tapping elsewhere closes an unsaved note box
    pinAt(e.clientX, e.clientY, document.elementFromPoint(e.clientX, e.clientY) || e.target);
  }, true);
  function pinAt(cx, cy, target){
    var a = anchorFor(target), r = a && a.getBoundingClientRect();
    var spot = {
      page: pageKey, skin: skin, anchor: a ? a.id : '',
      fx: a && r.width ? (cx - r.left) / r.width : null, fy: a && r.height ? (cy - r.top) / r.height : null,
      px: (cx + window.scrollX) / document.documentElement.scrollWidth, py: cy + window.scrollY,
      context: contextFor(target)
    };
    if(mark) mark.remove();
    mark = el('<div class="nt-mark"></div>'); mark.style.left = cx + 'px'; mark.style.top = cy + 'px'; document.body.appendChild(mark);
    showPop(cx, cy,
      '<div class="meta">New note' + (spot.context ? ' · on “' + esc(spot.context.slice(0, 50)) + '”' : '') + '</div>'+
      '<textarea placeholder="What should be better here?" maxlength="2000"></textarea>'+
      '<div class="acts"><button class="nt-b" type="button" data-a="cancel">Cancel</button><button class="nt-b pri" type="button" data-a="save">Save note</button></div>');
    var ta = pop.querySelector('textarea'); setTimeout(function(){ ta.focus(); }, 30);
    pop.onclick = function(ev){
      var b = ev.target.closest('[data-a]'); if(!b) return;
      if(b.getAttribute('data-a') === 'cancel'){ clearDraft(); return; }
      var text = ta.value.trim(); if(!text){ ta.focus(); return; }
      b.disabled = true;
      send(Object.assign({action:'add', text:text}, spot)).then(function(){ clearDraft(); var last = notes[notes.length - 1]; if(last) flash(last.id); });
    };
  }
  document.addEventListener('keydown', function(e){ if(e.key === 'Escape'){ if(!pop.hidden){ clearDraft(); } else if(adding) stopAdd(); } });

  function showPop(x, y, html){
    pop.innerHTML = html; pop.hidden = false;
    var w = pop.offsetWidth, h = pop.offsetHeight, vw = window.innerWidth, vh = window.innerHeight;
    pop.style.left = Math.max(12, Math.min(vw - w - 12, x - w / 2)) + 'px';
    pop.style.top = (y + h + 24 < vh ? y + 18 : Math.max(12, y - h - 18)) + 'px';
  }

  /* ---------- pins ---------- */
  function visible(){ return notes.filter(function(n){ return samePage(n) && (showDone || !n.done); }); }
  function numOf(n){ return notes.indexOf(n) + 1; }
  function cls(n){ return n.done ? 'done' : me && n.by === me.id ? 'mine' : ''; }
  function placePins(){
    pinLayer.innerHTML = '';
    if(!showPins) return;
    visible().forEach(function(n){
      var s = spotOf(n); if(!s || s.x < -20 || s.y < -20 || s.x > window.innerWidth + 20 || s.y > window.innerHeight + 20) return;
      var p = el('<div class="nt-pin" data-id="'+esc(n.id)+'" title="'+esc(n.byName)+': '+esc(n.text.slice(0, 80))+'"><span class="nt-n '+cls(n)+'">'+numOf(n)+'</span></div>');
      p.style.left = s.x + 'px'; p.style.top = s.y + 'px';
      p.onclick = function(e){ e.stopPropagation(); openNote(n, s.x, s.y); };
      pinLayer.appendChild(p);
    });
  }
  var raf = 0; function soon(){ if(!raf) raf = requestAnimationFrame(function(){ raf = 0; placePins(); if(!pop.hidden && openId) reposition(); }); }
  window.addEventListener('scroll', soon, true); window.addEventListener('resize', soon);
  setInterval(placePins, 1500);
  function reposition(){ var n = notes.find(function(x){ return x.id === openId; }); var s = n && spotOf(n); if(s){ var w = pop.offsetWidth; pop.style.left = Math.max(12, Math.min(window.innerWidth - w - 12, s.x - w / 2)) + 'px'; pop.style.top = (s.y + 18) + 'px'; } }
  function flash(id){ setTimeout(function(){ var p = pinLayer.querySelector('[data-id="'+id+'"]'); if(p) p.classList.add('flash'); }, 100); }

  function openNote(n, x, y){
    openId = n.id;
    var canDone = me && me.role === 'owner', canDel = me && (me.role === 'owner' || n.by === me.id);
    showPop(x, y, '<div class="meta"><b>#'+numOf(n)+'</b> · '+esc(n.byName)+' · '+esc(when(n.at))+(n.done ? ' · <b style="color:#16a34a">Done</b>' : '')+'</div>'+
      '<p>'+esc(n.text)+'</p>'+(n.context ? '<div class="ctx">On: “'+esc(n.context)+'”</div>' : '')+
      '<div class="acts">'+(canDone ? '<button class="nt-b" type="button" data-a="done">'+(n.done ? 'Reopen' : 'Mark done')+'</button>' : '')+
        (canDel ? '<button class="nt-b dang" type="button" data-a="del">Delete</button>' : '')+'<button class="nt-b" type="button" data-a="close">Close</button></div>');
    pop.onclick = function(ev){
      var b = ev.target.closest('[data-a]'); if(!b) return; var a = b.getAttribute('data-a');
      if(a === 'close'){ pop.hidden = true; openId = null; return; }
      if(a === 'del' && !confirm('Delete this note?')) return;
      send(a === 'done' ? {action:'done', id:n.id, done:!n.done} : {action:'delete', id:n.id}).then(function(){ pop.hidden = true; openId = null; });
    };
  }

  /* ---------- list ---------- */
  function draw(){
    var open = notes.filter(function(n){ return !n.done; });
    $('ntCount').textContent = open.length;
    $('ntWho').textContent = me ? (me.role === 'owner' ? 'Owner' : 'Reviewer: ' + me.name) : '';
    var here = notes.filter(function(n){ return samePage(n) && (showDone || !n.done); });
    var other = notes.filter(function(n){ return !samePage(n) && (showDone || !n.done); });
    function item(n){ return '<div class="nt-it'+(n.done ? ' done' : '')+'" data-id="'+esc(n.id)+'"><span class="nt-n '+cls(n)+'">'+numOf(n)+'</span><div><small>'+esc(n.byName)+' · '+esc(when(n.at))+
      (samePage(n) ? '' : ' · '+esc(pageName(n.page))+(n.skin === 'new' ? ' (new design)' : ''))+'</small><p>'+esc(n.text)+'</p></div></div>'; }
    $('ntList').innerHTML = (here.length ? '<div class="nt-g">On this screen</div>' + here.map(item).join('') : '<div class="nt-g">No notes on this screen yet</div>')+
      (other.length ? '<div class="nt-g">Other screens</div>' + other.map(item).join('') : '');
  }
  $('ntList').onclick = function(e){
    var it = e.target.closest('[data-id]'); if(!it) return;
    var n = notes.find(function(x){ return x.id === it.getAttribute('data-id'); }); if(!n) return;
    if(!samePage(n)){ location.href = (n.page === '/classic' ? '/' : n.page) + '#note-' + n.id; return; }
    goTo(n);
  };
  function goTo(n){
    var a = n.anchor && document.getElementById(n.anchor);
    if(a) a.scrollIntoView({block:'center', behavior:'smooth'}); else if(n.py != null) window.scrollTo({top:Math.max(0, n.py - window.innerHeight / 2), behavior:'smooth'});
    panel.hidden = window.matchMedia('(max-width:760px)').matches ? true : panel.hidden;
    setTimeout(function(){ placePins(); var s = spotOf(n); if(s) openNote(n, s.x, s.y); flash(n.id); }, 600);
  }

  /* ---------- data ---------- */
  function apply(j){ if(j && j.notes){ me = j.me; notes = j.notes; draw(); placePins(); } return j; }
  function load(){ return fetch('api/notes.json', {cache:'no-store', credentials:'same-origin'}).then(function(r){ return r.ok ? r.json() : null; }).then(apply).catch(function(){}); }
  function send(body){
    return fetch('api/notes.json', {method:'POST', headers:{'Content-Type':'application/json'}, credentials:'same-origin', body:JSON.stringify(body)})
      .then(function(r){ return r.json(); }).then(function(j){ if(j && j.error){ alert('Could not save: ' + j.error); } return apply(j); }).catch(function(){ alert('No connection. Please try again.'); });
  }
  load().then(function(){
    var m = /^#note-(.+)$/.exec(location.hash); if(!m) return;
    var n = notes.find(function(x){ return x.id === m[1]; }); if(n) setTimeout(function(){ goTo(n); }, 1200);
  });
  setInterval(function(){ if(!document.hidden && !adding && pop.hidden) load(); }, 60000);
})();
