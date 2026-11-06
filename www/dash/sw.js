/* Lets the dashboard install as an app and open when the router is unreachable. Only the page
   files are stored. Router data is never cached, and the network always wins when it answers,
   so a new version appears on its own. */
var CACHE = 'dash-shell-v1';
var SHELL = ['./', 'index.html', 'style.css', 'app.js', 'i18n.js', 'vazirmatn.woff2', 'icon-192.png'];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(SHELL); }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

self.addEventListener('fetch', function (e) {
  var url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.indexOf('/dash/') !== 0) return;
  e.respondWith(fetch(e.request).then(function (res) {
    if (res.ok) {
      var copy = res.clone();
      caches.open(CACHE).then(function (c) { c.put(e.request, copy); });
    }
    return res;
  }).catch(function () {
    return caches.match(e.request, { ignoreSearch: true });
  }));
});
