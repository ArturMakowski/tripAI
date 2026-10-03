/* TripAI service worker (T5b): shows web pushes from the proactive scan and opens the trip on tap.
 * Payload (backend tripai.notify.push.push_payload):
 *   { id, title, body, url: "/trips/{id}", recommendation_id, inputs_hash, kind }
 * No offline caching: this worker only handles push. */

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: "TripAI", body: event.data ? event.data.text() : "" };
  }
  const title = data.title || "TripAI";
  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || "",
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      tag: data.recommendation_id || data.id || "tripai",
      data: { id: data.id, url: data.url || "/inbox" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const { id, url } = event.notification.data || {};
  // /inbox/open loads the notification's card into the app, then lands on /trips/[id] (url).
  const target = id ? `/inbox/open?n=${encodeURIComponent(id)}` : url || "/inbox";
  event.waitUntil(
    (async () => {
      const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const w of wins) {
        if (new URL(w.url).origin === self.location.origin && "focus" in w) {
          await w.focus();
          return w.navigate(target);
        }
      }
      return self.clients.openWindow(target);
    })(),
  );
});
