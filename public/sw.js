// Service Worker — Barbearia Bot PWA
// Versão do cache — incrementar para forçar atualização
const CACHE_NAME = "barbearia-bot-v1";

// Assets do shell a colocar em cache para funcionamento offline
const SHELL_ASSETS = [
  "/admin.html",
  "/barber.html",
  "/login.html",
  "/manifest.json",
];

/* ---------- Install ---------- */
self.addEventListener("install", (event) => {
  // Pré-cache do shell do painel
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_ASSETS))
  );
  // Ativa imediatamente sem esperar o SW anterior ser descartado
  self.skipWaiting();
});

/* ---------- Activate ---------- */
self.addEventListener("activate", (event) => {
  // Remove caches de versões antigas
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
      )
  );
  // Assume o controle de todas as abas imediatamente
  self.clients.claim();
});

/* ---------- Fetch — Network First para APIs, Cache First para shell ---------- */
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // Requisições de API sempre vão para a rede
  if (url.pathname.startsWith("/api/")) return;

  // Para assets do shell, usa cache com fallback para rede
  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request))
  );
});

/* ---------- Push ---------- */
self.addEventListener("push", (event) => {
  if (!event.data) return;

  let data;
  try {
    data = event.data.json();
  } catch {
    data = { title: "Barbearia Bot", body: event.data.text(), url: "/admin.html" };
  }

  const options = {
    body: data.body || "",
    icon: "/manifest.json", // fallback — idealmente um ícone PNG real
    badge: "/manifest.json",
    data: { url: data.url || "/admin.html" },
    vibrate: [200, 100, 200],
    // Agrupa notificações do mesmo app para não acumular no painel de notificações
    tag: "barbearia-bot-appt",
    renotify: true,
    requireInteraction: false,
  };

  event.waitUntil(self.registration.showNotification(data.title || "Barbearia Bot", options));
});

/* ---------- Notification Click ---------- */
self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const targetUrl = event.notification.data?.url || "/admin.html";

  // Foca aba já aberta do painel, ou abre uma nova
  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clients) => {
        for (const client of clients) {
          if (client.url.includes(targetUrl) && "focus" in client) {
            return client.focus();
          }
        }
        if (self.clients.openWindow) {
          return self.clients.openWindow(targetUrl);
        }
      })
  );
});
