/* sw.js — 서비스워커 (오프라인 캐싱)
 *
 * 이 파일만은 인라인할 수 없다. 서비스워커는 같은 출처에서 별도 파일로 받아야 등록되고,
 * data:/blob: URL 로는 등록이 거부된다. 그래서 dist 는 index.html 하나가 아니라
 * index.html + sw.js + manifest + icons 묶음이 된다.
 *
 * 주의: 서비스워커는 보안 컨텍스트(HTTPS 또는 localhost)에서만 등록된다.
 * 집 와이파이의 http://192.168.x.x 주소에서는 등록이 실패한다 — 정상이다.
 * GitHub Pages(HTTPS)에 올린 뒤부터 오프라인이 동작한다.
 *
 * 캐시 이름에 빌드 번호가 들어간다(build.js 가 2026-08-25.6 를 치환).
 * 새 빌드를 올리면 캐시 이름이 바뀌고, 옛 캐시는 activate 에서 지운다.
 */

var VERSION = '2026-08-25.6';
var CACHE = 'fitlog-' + VERSION;

var SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icons/icon-180.png',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE)
      .then(function (cache) { return cache.addAll(SHELL); })
      // 아이콘 하나가 없다고 설치가 통째로 실패하면 오프라인이 아예 안 된다.
      .catch(function (err) { console.warn('[FitLog sw] 사전 캐싱 일부 실패', err); })
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (names) {
      return Promise.all(names.map(function (name) {
        if (name !== CACHE && name.indexOf('fitlog-') === 0) return caches.delete(name);
        return null;
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (event) {
  var req = event.request;
  if (req.method !== 'GET') return;

  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // 페이지 자체는 네트워크 우선 — 그래야 새 빌드가 바로 반영된다.
  // 네트워크가 없으면 캐시된 마지막 버전을 준다.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then(function (res) {
          var copy = res.clone();
          caches.open(CACHE).then(function (c) { c.put('./index.html', copy); });
          return res;
        })
        .catch(function () {
          return caches.match('./index.html').then(function (hit) {
            return hit || caches.match('./');
          }).then(function (hit) {
            return hit || offlineResponse();
          });
        })
    );
    return;
  }

  // 나머지(아이콘·manifest)는 캐시 우선 — 잘 안 바뀌고 빨라야 한다.
  event.respondWith(
    caches.match(req).then(function (hit) {
      if (hit) return hit;

      return fetch(req).then(function (res) {
        if (res && res.status === 200) {
          var copy = res.clone();
          caches.open(CACHE).then(function (c) { c.put(req, copy); });
        }
        return res;
      }).catch(function () {
        // 오프라인이고 캐시에도 없는 자원. 여기서 예외가 새어나가면
        // respondWith 가 거부되면서 콘솔에 처리되지 않은 오류가 쌓인다.
        return offlineResponse();
      });
    })
  );
});

function offlineResponse() {
  return new Response('', { status: 504, statusText: 'offline' });
}
