/* Offline support. The page itself is always fetched fresh when online,
   so each day's new data shows up straight away. Bump VERSION after changing assets. */
var VERSION = 'tracker-v46';
var SHELL = ['./', 'index.html', 'manifest.webmanifest', 'assets/hero-banner.webp', 'assets/hero-banner-sm.webp',
  'assets/majid-dcf-2026.webp', 'assets/dcf-face.webp', 'assets/splash/splash-poster.jpg', 'assets/admin.webp', 'assets/forest-bg.webp', 'assets/tree-1.webp', 'assets/tree-2.webp', 'assets/tree-3.webp', 'assets/icons/icon-192.png?v=3', 'assets/icons/icon-512.png?v=3'];

self.addEventListener('install', function(e){
  e.waitUntil(caches.open(VERSION).then(function(c){ return c.addAll(SHELL); }).then(function(){ return self.skipWaiting(); }));
});
self.addEventListener('activate', function(e){
  e.waitUntil(caches.keys().then(function(keys){
    return Promise.all(keys.filter(function(k){ return k !== VERSION; }).map(function(k){ return caches.delete(k); }));
  }).then(function(){ return self.clients.claim(); }));
});
self.addEventListener('fetch', function(e){
  var req = e.request;
  if(req.method !== 'GET') return;
  if(/\.(mp4|webm)(\?|$)/.test(req.url)) return;   // let the browser stream the intro video itself
  if(/\/api\//.test(req.url)) return;              // live numbers: always from the network, never from this cache
  if(/\/(control|dashboard|gate|today|person|places|stops|staff)(\.html)?\/?$/.test(new URL(req.url).pathname)) return;
  if(/\/(owner-tools|notes|owner-lib)\.js$/.test(new URL(req.url).pathname)) return;   // owner-only script: always fresh from the server   // owner pages and sign-in: never cached, never swapped for the main page
  var isPage = req.mode === 'navigate' || req.url.endsWith('.html') || req.url.endsWith('.webmanifest');
  if(isPage){
    // network first, skipping the browser cache, so the latest daily data always shows
    var key = req.mode === 'navigate' ? 'index.html' : req;
    e.respondWith(fetch(req.url, {cache: 'no-store', credentials: 'same-origin'}).then(function(res){
      if(res.ok){ var copy = res.clone(); caches.open(VERSION).then(function(c){ c.put(key, copy); }); }
      return res;
    }).catch(function(){ return caches.match(key).then(function(r){ return r || caches.match('index.html'); }); }));
  } else {
    // cache first for images, fonts and other static files
    e.respondWith(caches.match(req).then(function(hit){
      return hit || fetch(req).then(function(res){
        if(res.ok || res.type === 'opaque'){ var copy = res.clone(); caches.open(VERSION).then(function(c){ c.put(req, copy); }); }
        return res;
      });
    }));
  }
});

/* Buzzer: a push carries no content; ask the server what to show, then show it loudly. */
self.addEventListener('push', function(e){
  e.waitUntil(fetch('/api/push/what', {credentials:'include', cache:'no-store'}).then(function(r){ return r.json(); }).catch(function(){ return {title:'DC Forest', body:'Open the app', url:'/staff', urgent:true, tag:'stop'}; })
    .then(function(d){
      return self.registration.showNotification(d.title || 'DC Forest', {
        body: d.body || '', tag: d.tag || 'dcf', renotify: true, requireInteraction: !!d.urgent,
        vibrate: d.urgent ? [800,200,800,200,800,200,1200] : [200], icon: '/assets/icons/icon-192.png?v=3', badge: '/assets/icons/favicon-32.png?v=3',
        data: {url: d.url || '/'}
      });
    }));
});
self.addEventListener('notificationclick', function(e){
  e.notification.close();
  var url = (e.notification.data && e.notification.data.url) || '/';
  e.waitUntil(self.clients.matchAll({type:'window', includeUncontrolled:true}).then(function(list){
    for(var i = 0; i < list.length; i++){ if(new URL(list[i].url).pathname === new URL(url, self.location.origin).pathname && 'focus' in list[i]) return list[i].focus(); }
    return self.clients.openWindow(url);
  }));
});
