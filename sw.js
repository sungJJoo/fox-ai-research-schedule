// FOX AI 연구소 담당표 — Service Worker
// 정적 파일은 stale-while-revalidate, GAS API는 네트워크 only
// 코드 배포 시 CACHE_VERSION 을 올려서 강제 갱신

const CACHE_VERSION = 'fox-v1';
const STATIC_ASSETS = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './manifest.json',
  './icon.svg',
];

self.addEventListener('install', e => {
  // 새 SW 즉시 활성화 (대기 큐 건너뜀)
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE_VERSION).then(cache => cache.addAll(STATIC_ASSETS))
      .catch(err => console.warn('[SW] precache 일부 실패', err))
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== CACHE_VERSION).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())  // 새로고침 없이도 모든 탭에 적용
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if(req.method !== 'GET') return;  // POST 등은 우회

  const url = new URL(req.url);

  // 1) GAS API — 항상 네트워크. 오프라인이면 그냥 실패시켜서 클라이언트가 .catch()로 처리
  if(url.hostname === 'script.google.com' || url.hostname === 'script.googleusercontent.com'){
    return;  // SW가 처리 안 함 → 브라우저 기본 동작 (네트워크)
  }

  // 2) Google Fonts — cache-first (한 번 받으면 안 바뀜)
  if(url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com'){
    e.respondWith(
      caches.match(req).then(cached => cached || fetch(req).then(res => {
        if(res && res.ok){
          const clone = res.clone();
          caches.open(CACHE_VERSION).then(c => c.put(req, clone));
        }
        return res;
      }).catch(() => cached))
    );
    return;
  }

  // 3) 같은 출처 (앱 본체) — stale-while-revalidate
  if(url.origin === self.location.origin){
    e.respondWith(
      caches.match(req).then(cached => {
        const networkFetch = fetch(req).then(res => {
          if(res && res.ok){
            const clone = res.clone();
            caches.open(CACHE_VERSION).then(c => c.put(req, clone));
          }
          return res;
        }).catch(() => cached);  // 오프라인이면 캐시 폴백
        return cached || networkFetch;
      })
    );
  }
});
