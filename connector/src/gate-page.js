/* The entry page shown instead of the site until a pass is entered. Also the owner's panel (infinity box).
   Note for editing: this is one JavaScript string, so the page's own script avoids backticks. */
export const GATE_PAGE = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Daily Activity Tracker — Private</title>
<meta name="robots" content="noindex, nofollow">
<meta name="theme-color" content="#071a0d">
<link rel="icon" type="image/png" sizes="32x32" href="/assets/icons/favicon-32.png?v=3">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@600;700;800&family=Figtree:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<style>
*{box-sizing:border-box}
html,body{height:100%;margin:0}
body{font-family:Figtree,system-ui,sans-serif;color:#e8f1df;background:#071a0d;display:flex;align-items:center;justify-content:center;padding:20px;
  background-image:linear-gradient(rgba(5,20,10,.82),rgba(5,20,10,.94)),url(/assets/forest-bg.webp);background-size:cover;background-position:center}
.card{width:100%;max-width:420px;padding:30px 26px 26px;border-radius:22px;background:rgba(12,38,22,.82);border:1px solid rgba(252,222,132,.28);
  box-shadow:0 24px 60px rgba(0,0,0,.5);backdrop-filter:blur(8px);text-align:center}
.logo{width:68px;height:68px;border-radius:18px;display:block;margin:0 auto 14px;box-shadow:0 6px 18px rgba(0,0,0,.4)}
h1{margin:0;font-family:"Playfair Display",Georgia,serif;font-size:1.6rem;color:#fcde84;line-height:1.15}
.org{margin:6px 0 20px;color:#b9cfa9;font-size:.86rem}
p.lead{margin:0 0 14px;font-size:.95rem;color:#d9e6cc}
label{display:block;text-align:left;font-size:.74rem;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#a9c197;margin:0 0 6px 4px}
input{width:100%;padding:14px 16px;border-radius:14px;border:1px solid rgba(255,255,255,.18);background:rgba(0,0,0,.28);color:#fff;font:700 1.25rem Figtree,system-ui,sans-serif;
  letter-spacing:.22em;text-align:center;text-transform:uppercase;outline:none}
input:focus{border-color:#fcde84;box-shadow:0 0 0 3px rgba(252,222,132,.2)}
input::placeholder{color:rgba(255,255,255,.28);letter-spacing:.22em}
button{font:inherit;cursor:pointer}
.go{width:100%;margin-top:12px;padding:14px;border:0;border-radius:14px;font-weight:800;font-size:1rem;color:#1c2a10;background:linear-gradient(135deg,#fcde84,#e2b64a)}
.go:disabled{opacity:.6;cursor:default}
.go.cr{display:block;margin:0 0 12px;text-align:center;text-decoration:none;color:#fff;background:linear-gradient(135deg,#2f8a52,#1f6b45);border:1px solid #fcde84}
.go.cr.map{margin-bottom:22px;background:linear-gradient(135deg,#1d5a74,#173f58)}
.theme{display:flex;align-items:center;justify-content:space-between;gap:12px;margin:0 0 22px;padding:12px 14px;border-radius:14px;background:rgba(0,0,0,.25);border:1px solid rgba(252,222,132,.35)}
.theme b{display:block;color:#fcde84}
.theme small{display:block;color:#b9cfa9;font-size:.78rem;margin-top:2px}
.theme .seg{display:inline-flex;border:1px solid rgba(252,222,132,.5);border-radius:10px;overflow:hidden;flex:none}
.theme .seg button{background:transparent;border:0;color:#fcde84;font-weight:800;padding:8px 14px;cursor:pointer;font:inherit;font-weight:800}
.theme .seg button[aria-pressed="true"]{background:#e0bb4b;color:#1c2a10}
.go.cr small{display:block;font-weight:600;font-size:.78rem;color:#d5ecd9;margin-top:3px}
.msg{min-height:1.3em;margin:10px 0 0;font-size:.86rem;font-weight:600;color:#fca5a5}
.msg.ok{color:#86efac}
.inf{position:fixed;top:14px;right:14px;width:46px;height:46px;border-radius:13px;border:1px solid rgba(252,222,132,.35);background:rgba(12,38,22,.8);color:#fcde84;
  font-size:1.7rem;line-height:1;display:flex;align-items:center;justify-content:center;padding:0 0 3px}
.inf:hover,.inf[aria-expanded=true]{background:rgba(252,222,132,.16)}
.small{font-size:.8rem;color:#93a888;margin:16px 0 0}
[hidden]{display:none!important}
.panel{text-align:left}
.panel h2{margin:0 0 4px;font-family:"Playfair Display",Georgia,serif;color:#fcde84;font-size:1.3rem;text-align:center}
.panel .sub{margin:0 0 16px;text-align:center;color:#b9cfa9;font-size:.84rem}
.new{margin:12px 0 0;padding:14px;border-radius:14px;background:rgba(252,222,132,.1);border:1px dashed rgba(252,222,132,.5);text-align:center}
.new b{display:block;font-size:1.9rem;letter-spacing:.2em;color:#fff4d1;margin:2px 0 8px}
.new span{font-size:.8rem;color:#d9e6cc}
.mini{padding:7px 13px;border-radius:99px;border:1px solid rgba(255,255,255,.22);background:rgba(255,255,255,.07);color:#e8f1df;font-size:.8rem;font-weight:700}
.mini:hover{background:rgba(255,255,255,.14)}
.mini.danger{border-color:rgba(252,165,165,.5);color:#fecaca}
h3{margin:20px 0 8px;font-size:.74rem;letter-spacing:.1em;text-transform:uppercase;color:#a9c197}
ul{list-style:none;margin:0;padding:0}
li{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:9px 12px;border-radius:12px;background:rgba(0,0,0,.22);margin-bottom:6px;font-size:.86rem}
li code{font:800 1rem Figtree,system-ui,sans-serif;letter-spacing:.14em;color:#fff}
li small{display:block;color:#93a888;font-size:.74rem;margin-top:2px}
li .acts{display:flex;gap:6px;flex-shrink:0}
li.used code{color:#8fa583;text-decoration:line-through}
.row{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px;border-radius:12px;background:rgba(0,0,0,.22);font-size:.88rem}
.row small{display:block;color:#93a888;font-size:.76rem;margin-top:2px}
.revf{display:flex;gap:8px;margin:6px 0 10px}.revf input{flex:1;min-width:0;padding:10px 12px;border-radius:12px;border:1px solid rgba(252,222,132,.4);background:rgba(0,0,0,.25);color:#fff;font:inherit}
.foot{display:flex;flex-wrap:wrap;gap:8px;justify-content:center;margin-top:18px}
a.mini{text-decoration:none;display:inline-block}
</style>
</head>
<body>
<button class="inf" id="inf" type="button" aria-label="Owner access" aria-expanded="false" title="Owner access">&infin;</button>

<main class="card">
  <img class="logo" src="/assets/icons/icon-192.png?v=3" alt="" width="68" height="68">

  <section id="vEnter">
    <h1>Daily Activity Tracker</h1>
    <div class="org">Publicity and Extension Division, Lahore</div>
    <p class="lead">This site is private. Enter your access pass to continue.</p>
    <form id="fEnter" autocomplete="off">
      <label for="code">Access pass</label>
      <input id="code" name="code" maxlength="7" inputmode="text" autocapitalize="characters" spellcheck="false" placeholder="ABC-123" required>
      <button class="go" type="submit">Enter</button>
    </form>
    <p class="msg" id="mEnter" role="alert"></p>
    <p class="small">A pass works once and gives 30 minutes of access.</p>
  </section>

  <section id="vPin" hidden>
    <h1>Owner access</h1>
    <div class="org">Enter your PIN to manage passes</div>
    <form id="fPin" autocomplete="off">
      <label for="pin">PIN</label>
      <input id="pin" name="pin" type="password" inputmode="numeric" maxlength="12" placeholder="••••" required>
      <button class="go" type="submit">Unlock</button>
    </form>
    <p class="msg" id="mPin" role="alert"></p>
  </section>

  <section id="vReviewer" class="panel" hidden>
    <h2>Reviewer access</h2>
    <p class="sub">Signed in as <b id="rvName"></b>. You can see everything the owner sees and leave notes; you cannot change settings.</p>
    <a class="go cr" href="./">Open the page<small>Tap the Notes button to leave a note on any spot</small></a>
    <a class="go cr map" href="control">Open Control Room<small>Live map, people, stops</small></a>
    <div class="theme"><div><b>My design</b><small id="rvThemeSub"></small></div>
      <div class="seg" id="rvSeg" role="group" aria-label="Design"><button type="button" data-rtheme="classic">Classic</button><button type="button" data-rtheme="new">New</button></div></div>
    <div class="foot"><button class="mini danger" id="bRvOut" type="button">Sign out on this device</button></div>
  </section>

  <section id="vAdmin" class="panel" hidden>
    <a class="go cr" href="./">Open my page<small>Your page with the owner tools: alerts, activity log, reports</small></a>
    <a class="go cr map" href="control">Open Control Room<small>Live map, people, routes (owner only)</small></a>
    <div class="theme"><div><b>My design</b><small id="themeSub"></small></div>
      <div class="seg" role="group" aria-label="Site design"><button type="button" data-theme="classic">Classic</button><button type="button" data-theme="new">New</button></div></div>
    <h2>Access passes</h2>
    <p class="sub">Each pass lets one person in, once, for <span id="mins">30</span> minutes.</p>
    <button class="go" id="bNew" type="button">Create one-time pass</button>
    <div class="new" id="newBox" hidden><span>Give this pass to your visitor</span><b id="newCode"></b><button class="mini" id="bCopy" type="button">Copy</button></div>
    <p class="msg" id="mAdmin" role="alert"></p>

    <h3>Waiting to be used</h3>
    <ul id="lUnused"></ul>
    <h3>Already used</h3>
    <ul id="lUsed"></ul>

    <h2 style="margin-top:22px">Reviewers</h2>
    <p class="sub">A reviewer sees everything you see (Control Room, stops, alerts, reports, photos, the new design) and can leave notes, but cannot change any settings. Their pass works once, then that device stays in for 30 days until you cancel it.</p>
    <form id="fRev" class="revf" autocomplete="off"><input id="revName" maxlength="40" placeholder="Reviewer's name" required><button class="mini" type="submit">Create reviewer pass</button></form>
    <div class="new" id="revBox" hidden><span>Give this reviewer pass to <b id="revWho"></b></span><b id="revCode"></b><button class="mini" id="bRevCopy" type="button">Copy</button></div>
    <ul id="lRev"></ul>

    <h3>Site access</h3>
    <div class="row"><div><b id="openLabel"></b><small id="openSub"></small></div><button class="mini" id="bOpen" type="button"></button></div>

    <div class="foot">
      <a class="mini" href="/">Open the site</a>
      <button class="mini danger" id="bOut" type="button" title="Ends every visitor's access now, and yours">Sign everyone out</button>
    </div>
  </section>
</main>

<script>
(function(){
  var $ = function(id){ return document.getElementById(id); };
  var views = ['vEnter','vPin','vAdmin','vReviewer'];
  function show(v){ views.forEach(function(x){ $(x).hidden = x !== v; }); $('inf').setAttribute('aria-expanded', v !== 'vEnter'); }
  function post(path, body){
    return fetch('/api/gate/' + path, {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body || {}), credentials:'same-origin'})
      .then(function(r){ return r.json().catch(function(){ return {}; }).then(function(j){ j.status = r.status; return j; }); });
  }
  function fail(j, what){
    if(j.status === 429) return 'Too many wrong tries. Try again in ' + j.minutes + ' minute' + (j.minutes === 1 ? '' : 's') + '.';
    if(j.status === 503) return 'The site owner has not finished setting up access yet.';
    if(j.status === 401) return what;
    return 'Something went wrong. Please try again.';
  }
  function fmtCode(c){ return c.slice(0,3) + '-' + c.slice(3); }
  function when(iso){ var d = new Date(iso); return d.toLocaleDateString('en-GB',{day:'numeric',month:'short'}) + ', ' + d.toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'}); }
  function esc(s){ return String(s).replace(/[&<>"']/g, function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); }

  /* visitor */
  $('code').addEventListener('input', function(){
    var v = this.value.toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,6);
    this.value = v.length > 3 ? v.slice(0,3) + '-' + v.slice(3) : v;
  });
  $('fEnter').addEventListener('submit', function(e){
    e.preventDefault(); var b = this.querySelector('button'); b.disabled = true; $('mEnter').className = 'msg'; $('mEnter').textContent = '';
    post('enter', {code: $('code').value}).then(function(j){
      if(j.ok){ $('mEnter').className = 'msg ok'; $('mEnter').textContent = j.reviewer ? 'Welcome, reviewer. Opening the site…' : 'Welcome. Opening the site…'; location.replace('/'); return; }
      b.disabled = false; $('mEnter').textContent = fail(j, 'That pass is not valid, or has already been used.');
    }).catch(function(){ b.disabled = false; $('mEnter').textContent = 'No connection. Please try again.'; });
  });

  /* owner */
  var isAdmin = false;
  $('inf').addEventListener('click', function(){
    if(isAdmin){ show($('vAdmin').hidden ? 'vAdmin' : 'vEnter'); return; }
    if(isReviewer){ show($('vReviewer').hidden ? 'vReviewer' : 'vEnter'); return; }
    show($('vPin').hidden ? 'vPin' : 'vEnter'); if(!$('vPin').hidden) $('pin').focus();
  });
  $('fPin').addEventListener('submit', function(e){
    e.preventDefault(); var b = this.querySelector('button'); b.disabled = true; $('mPin').textContent = '';
    post('admin', {pin: $('pin').value}).then(function(j){
      b.disabled = false; $('pin').value = '';
      if(j.ok){ isAdmin = true; draw(j); show('vAdmin'); return; }
      $('mPin').textContent = fail(j, 'Wrong PIN.');
    }).catch(function(){ b.disabled = false; $('mPin').textContent = 'No connection. Please try again.'; });
  });
  function draw(s){
    $('mins').textContent = s.guestMinutes;
    var unused = s.passes.filter(function(p){ return !p.usedAt; }), used = s.passes.filter(function(p){ return p.usedAt; }).reverse();
    $('lUnused').innerHTML = unused.length ? unused.map(function(p){
      return '<li><div><code>' + esc(fmtCode(p.code)) + '</code><small>Created ' + esc(when(p.createdAt)) + '</small></div><span class="acts"><button class="mini" type="button" data-copy="' + esc(fmtCode(p.code)) + '">Copy</button><button class="mini danger" type="button" data-revoke="' + esc(p.code) + '">Cancel</button></span></li>';
    }).join('') : '<li><span>No passes waiting.</span></li>';
    $('lUsed').innerHTML = used.length ? used.map(function(p){
      return '<li class="used"><div><code>' + esc(fmtCode(p.code)) + '</code><small>Used ' + esc(when(p.usedAt)) + '</small></div></li>';
    }).join('') : '<li><span>None yet.</span></li>';
    document.querySelectorAll('[data-theme]').forEach(function(b){ b.setAttribute('aria-pressed', b.getAttribute('data-theme') === (s.theme || 'classic')); });
    $('themeSub').textContent = (s.theme === 'new' ? 'New design on this device.' : 'Classic design on this device.') + ' Visitors always see the classic site.';
    var rv = s.reviewers || [];
    $('lRev').innerHTML = rv.length ? rv.map(function(r){
      return '<li><div><b>' + esc(r.name) + '</b>' + (r.usedAt ? '<small>Signed in ' + esc(when(r.usedAt)) + '</small>' : '<small>Pass <code style="font-size:.85rem">' + esc(fmtCode(r.code)) + '</code> not used yet</small>') + '</div>' +
        '<span class="acts">' + (r.usedAt ? '' : '<button class="mini" type="button" data-copy="' + esc(fmtCode(r.code)) + '">Copy</button>') + '<button class="mini danger" type="button" data-rrevoke="' + esc(r.id) + '">Cancel</button></span></li>';
    }).join('') : '<li><span>No reviewers yet.</span></li>';
    $('openLabel').textContent = s.open ? 'Open to everyone' : 'Private';
    $('openSub').textContent = s.open ? 'Anyone with the address can view the site.' : 'A pass is needed to view the site.';
    $('bOpen').textContent = s.open ? 'Make private' : 'Open to everyone';
    $('bOpen').setAttribute('data-open', s.open ? '0' : '1');
  }
  function act(path, body, after){
    $('mAdmin').className = 'msg'; $('mAdmin').textContent = '';
    return post(path, body).then(function(j){
      if(j.status === 403){ isAdmin = false; show('vPin'); $('mPin').textContent = 'Your owner session ended. Enter the PIN again.'; return; }
      if(!j.ok){ $('mAdmin').textContent = j.error === 'too-many' ? 'There are already 20 unused passes. Cancel some first.' : 'That did not work. Please try again.'; return; }
      if(j.passes) draw(j); if(after) after(j);
    }).catch(function(){ $('mAdmin').textContent = 'No connection. Please try again.'; });
  }
  $('bNew').addEventListener('click', function(){ act('pass', {}, function(j){ $('newCode').textContent = fmtCode(j.code); $('newBox').hidden = false; $('bCopy').textContent = 'Copy'; }); });
  function copy(text, btn){
    function done(){ btn.textContent = 'Copied'; setTimeout(function(){ btn.textContent = 'Copy'; }, 1800); }
    function old(){ var t = document.createElement('textarea'); t.value = text; t.style.position = 'fixed'; t.style.opacity = '0'; document.body.appendChild(t); t.select();
      try{ if(document.execCommand('copy')) done(); }catch(e){} document.body.removeChild(t); }
    if(navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, old); else old();
  }
  $('bCopy').addEventListener('click', function(){ copy($('newCode').textContent, this); });
  $('lUnused').addEventListener('click', function(e){ var c = e.target.closest('[data-copy]'); if(c){ copy(c.getAttribute('data-copy'), c); return; }
    var b = e.target.closest('[data-revoke]'); if(b) act('revoke', {code: b.getAttribute('data-revoke')}, function(){ $('newBox').hidden = true; }); });
  $('bOpen').addEventListener('click', function(){
    var open = this.getAttribute('data-open') === '1';
    if(open && !confirm('Open the site to everyone? Anyone with the address will be able to view it without a pass.')) return;
    act('open', {open: open});
  });
  $('bOut').addEventListener('click', function(){
    if(!confirm('Sign everyone out? Every visitor loses access now, and you will need your PIN again.')) return;
    act('signout', {}, function(){ isAdmin = false; show('vEnter'); });
  });
  document.querySelector('.theme .seg').onclick = function(e){
    var b = e.target.closest('[data-theme]'); if(!b) return;
    var th = b.getAttribute('data-theme');
    act('theme', {theme: th});
  };

  $('fRev').addEventListener('submit', function(e){
    e.preventDefault(); var name = $('revName').value.trim(); if(!name) return;
    act('reviewer-pass', {name: name}, function(j){ $('revCode').textContent = fmtCode(j.code); $('revWho').textContent = name; $('revBox').hidden = false; $('revName').value = ''; });
  });
  $('bRevCopy').addEventListener('click', function(){ copy($('revCode').textContent, this); });
  $('lRev').addEventListener('click', function(e){
    var c = e.target.closest('[data-copy]'); if(c){ copy(c.getAttribute('data-copy'), c); return; }
    var b = e.target.closest('[data-rrevoke]'); if(b && confirm('Cancel access for this reviewer? Their device is signed out at once.')) act('reviewer-revoke', {id: b.getAttribute('data-rrevoke')}, function(){ $('revBox').hidden = true; });
  });

  /* reviewer */
  var isReviewer = false;
  function drawReviewer(s){
    $('rvName').textContent = s.name || 'Reviewer';
    document.querySelectorAll('[data-rtheme]').forEach(function(b){ b.setAttribute('aria-pressed', b.getAttribute('data-rtheme') === (s.theme || 'classic')); });
    $('rvThemeSub').textContent = s.theme === 'new' ? 'New design on this device.' : 'Classic design on this device.';
  }
  $('rvSeg').onclick = function(e){ var b = e.target.closest('[data-rtheme]'); if(!b) return;
    post('theme', {theme: b.getAttribute('data-rtheme')}).then(function(j){ if(j.ok) drawReviewer(j); }); };
  $('bRvOut').onclick = function(){ post('leave', {}).then(function(){ isReviewer = false; show('vEnter'); }); };

  /* already signed in as owner or reviewer? go straight to the panel */
  fetch('/api/gate/state', {credentials:'same-origin'}).then(function(r){ return r.ok ? r.json() : null; }).then(function(s){
    if(s && s.passes){ isAdmin = true; draw(s); if(location.pathname === '/gate') show('vAdmin'); }
    else if(s && s.reviewer){ isReviewer = true; drawReviewer(s); if(location.pathname === '/gate') show('vReviewer'); }
  }).catch(function(){});
})();
</script>
</body>
</html>`;
