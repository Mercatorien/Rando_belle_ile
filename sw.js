const CACHE_NAME = 'rando-cache-v2';

// Fichiers à stocker localement
const urlsToCache = [
    './',
    './index.html',
    './journal.html',
    './style.css',
    './app.js',
    './journal.js',
    './manifest.json',
    './data/gr.geojson',
    './data/data.csv',
    'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
    'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
    'https://cdn.jsdelivr.net/npm/chart.js',
    'https://unpkg.com/@turf/turf@6/turf.min.js'
];

// Installation du service worker et mise en cache
self.addEventListener('install', event => {
    self.skipWaiting();
    event.waitUntil(
        caches.open(CACHE_NAME).then(cache => {
            return cache.addAll(urlsToCache);
        })
    );
});

// Activation : suppression des anciens caches (ex. v1)
self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys().then(keys => Promise.all(
            keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
        )).then(() => self.clients.claim())
    );
});

// Interception des requêtes : on sert le cache si on est hors ligne
self.addEventListener('fetch', event => {
    event.respondWith(
        caches.match(event.request).then(response => {
            return response || fetch(event.request);
        })
    );
});