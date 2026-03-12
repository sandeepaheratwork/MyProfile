/**
 * TechForge Service Worker
 * Handles Web Push Notifications
 */

const CACHE_NAME = 'techforge-v1';

self.addEventListener('install', event => {
    self.skipWaiting();
});

self.addEventListener('activate', event => {
    event.waitUntil(clients.claim());
});

// Handle incoming push messages
self.addEventListener('push', event => {
    let data = {};
    try {
        data = event.data ? event.data.json() : {};
    } catch (e) {
        data = { title: 'TechForge', body: event.data ? event.data.text() : 'You have a new notification' };
    }

    const title = data.title || 'TechForge';
    const options = {
        body: data.body || '',
        icon: '/assets/owner-profile.jpg',
        badge: '/assets/owner-profile.jpg',
        data: data.url ? { url: data.url } : {},
        vibrate: [100, 50, 100],
        actions: data.actions || []
    };

    event.waitUntil(self.registration.showNotification(title, options));
});

// Handle notification click → open the app
self.addEventListener('notificationclick', event => {
    event.notification.close();
    const url = event.notification.data?.url || '/';
    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {
            for (const client of clientList) {
                if (client.url === url && 'focus' in client) return client.focus();
            }
            if (clients.openWindow) return clients.openWindow(url);
        })
    );
});
