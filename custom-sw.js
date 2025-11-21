// This event is fired when the service worker is first downloaded by the browser
self.addEventListener('install', (event) => {
    console.log('Service Worker: Installed successfully!');
    // Optional: Force the new service worker to activate immediately 
    // without waiting for the user to close all existing tabs.
    self.skipWaiting(); 
});

// This event is fired when the service worker is activated (becomes ready to control pages)
self.addEventListener('activate', (event) => {
    console.log('Service Worker: Activated and ready to intercept network requests.');
    event.waitUntil(self.clients.claim()); 
    self.clients.matchAll().then(clients => {
      clients.forEach(client => {
        client.postMessage({ type: 'SW_STATUS', status: 'Activated' });
      });
    });
});

// Optional: Add a simple fetch listener to prove it can intercept requests
self.addEventListener('fetch', (event) => {
    // console.log('Service Worker: Intercepting fetch request for:', event.request.url);
});

console.log('Service Worker: Script loaded.');
