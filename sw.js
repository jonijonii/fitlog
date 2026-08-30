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
 * 캐시 이름에 빌드 번호가 들어간다(build.js 가 2026-08-30.16 를 치환).
 * 새 빌드를 올리면 캐시 이름이 바뀌고, 옛 캐시는 activate 에서 지운다.
 */

var VERSION = '2026-08-30.16';
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
    caches.open(CACHE).then(function (cache) {
      // addAll 은 전부-아니면-전무다. 하나만 실패해도 통째로 거부되어
      // 캐시가 텅 빈 채로 워커가 켜진다 (실제로 이 상태에서 앱이 안 열렸다).
      // 하나씩 담아서 실패한 것만 빠지게 한다.
      return Promise.all(SHELL.map(function (url) {
        return cache.add(url)['catch'](function (err) {
          console.warn('[FitLog sw] 캐시 실패: ' + url, err);
        });
      }));
    }).then(function () {
      return self.skipWaiting();
    })
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

  var url;
  try {
    url = new URL(req.url);
  } catch (e) {
    return;                                  // 주소를 못 읽으면 끼어들지 않는다
  }
  if (url.origin !== self.location.origin) return;

  // 비상 탈출구: ?nosw 를 붙여 열면 워커가 스스로 물러난다.
  // 워커가 잘못된 응답을 물고 있어 앱이 안 열릴 때 쓰는 마지막 수단이다.
  if (url.search.indexOf('nosw') >= 0) {
    self.registration.unregister();
    return;
  }

  if (req.mode === 'navigate') {
    event.respondWith(handleNavigate(req));
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
      })['catch'](function () {
        // 오프라인이고 캐시에도 없는 자원. 예외가 새어나가면 respondWith 가 거부된다.
        return new Response('', { status: 504, statusText: 'offline' });
      });
    })
  );
});

/* 페이지 요청은 네트워크 우선 — 그래야 새 빌드가 바로 반영된다.
   네트워크가 없으면 캐시된 마지막 버전을 준다. */
function handleNavigate(req) {
  return fetch(req)
    .then(function (res) {
      if (res && res.status === 200) {
        var copy = res.clone();
        caches.open(CACHE).then(function (c) { c.put('./index.html', copy); });
      }
      return res;
    })['catch'](function () {
      return caches.match('./index.html')
        .then(function (hit) { return hit || caches.match('./'); })
        .then(function (hit) { return hit || recoveryPage(); });
    });
}

/* 네트워크도 캐시도 없을 때 주는 마지막 화면.
 *
 * ⚠️ 여기서 절대 빈 504 를 주면 안 된다. 페이지 요청에 빈 응답을 주면
 *    사파리가 "인터넷에 연결되어 있지 않기 때문에 페이지를 열 수 없습니다" 로 막아버리고,
 *    사용자는 앱을 지웠다 다시 까는 것 말고는 빠져나올 방법이 없다. (실제로 이 일이 났다.)
 *    읽을 수 있는 HTML 을 200 으로 주고, 그 안에서 스스로 복구할 수단을 쥐여준다.
 */
function recoveryPage() {
  var html = [
    '<!doctype html><html lang="ko"><head><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">',
    '<title>FitLog</title><style>',
    'body{margin:0;padding:32px 20px;font:16px/1.6 -apple-system,BlinkMacSystemFont,',
    '"Apple SD Gothic Neo","Malgun Gothic",sans-serif;background:#111827;color:#e8eaee}',
    'h1{font-size:20px;margin:0 0 12px}p{color:#9aa2b1;margin:0 0 20px}',
    'button{width:100%;min-height:52px;margin-bottom:10px;border:0;border-radius:12px;',
    'font-size:16px;font-weight:600;font-family:inherit;background:#5b8cff;color:#fff}',
    '.sub{background:transparent;border:1px solid #2b313c;color:#9aa2b1}',
    '</style></head><body>',
    '<h1>앱을 불러오지 못했어</h1>',
    '<p>기록은 그대로 있어. 아래를 차례로 눌러봐.</p>',
    '<button onclick="location.reload()">다시 시도</button>',
    '<button class="sub" onclick="fix()">복구하고 다시 열기</button>',
    '<script>function fix(){',
    'if(navigator.serviceWorker){navigator.serviceWorker.getRegistrations()',
    '.then(function(rs){return Promise.all(rs.map(function(r){return r.unregister()}))})',
    '.then(function(){return caches.keys()})',
    '.then(function(ks){return Promise.all(ks.map(function(k){return caches.delete(k)}))})',
    '.then(function(){location.reload()})["catch"](function(){location.reload()})}',
    'else{location.reload()}}<\/script>',
    '</body></html>'
  ].join('');

  return new Response(html, {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8' }
  });
}
