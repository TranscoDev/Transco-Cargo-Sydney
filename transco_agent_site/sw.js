/*
 * My Transco notifications — shows the pop-up when the Transco team
 * replies (sent by the backend's pushNotify.js), and opens the chat when
 * it's tapped. Only handles notifications: it never touches page loading
 * or caching.
 */
self.addEventListener("install", function () { self.skipWaiting(); });
self.addEventListener("activate", function (e) { e.waitUntil(self.clients.claim()); });

self.addEventListener("push", function (e) {
  var d = {};
  try { d = e.data ? e.data.json() : {}; } catch (err) { d = { body: e.data ? e.data.text() : "" }; }
  e.waitUntil(self.registration.showNotification(d.title || "Transco Cargo", {
    body: d.body || "",
    tag: d.tag || undefined,
    renotify: Boolean(d.tag),
    icon: "/favicon.png",
    badge: "/favicon.png",
    data: { url: d.url || "/account.html" }
  }));
});

self.addEventListener("notificationclick", function (e) {
  e.notification.close();
  var url = new URL((e.notification.data && e.notification.data.url) || "/account.html", self.location.origin).href;
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(function (list) {
    for (var i = 0; i < list.length; i++) {
      var c = list[i];
      if (c.url.indexOf(self.location.origin) === 0 && "focus" in c) {
        return c.focus().then(function (w) { return w && "navigate" in w ? w.navigate(url).catch(function () {}) : null; });
      }
    }
    return self.clients.openWindow(url);
  }));
});
