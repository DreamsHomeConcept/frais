/* Frais — service worker : ouverture de l'application sans réseau.
 * - La page : réseau d'abord (les mises à jour arrivent tout de suite), copie locale si pas de réseau.
 * - Logos, icônes, bibliothèques (Firebase, PDF, police) : copie locale d'abord.
 * - Base de données et connexion (googleapis.com) : jamais interceptées, Firebase gère lui-même le hors ligne.
 */
const CACHE = "frais-v1";
const PAGE = new URL("./", self.registration.scope).href;
const FICHIERS = ["logo-mark.png", "logo-auth.png", "logo-pdf.png", "favicon.png", "apple-touch-icon.png", "manifest.webmanifest"];
const BIBLIOTHEQUES = [
  "https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js",
  "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth-compat.js",
  "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore-compat.js"
];
const HOTES_BIBLIOTHEQUES = ["www.gstatic.com", "cdn.jsdelivr.net", "fonts.googleapis.com", "fonts.gstatic.com"];

self.addEventListener("install", ev => {
  ev.waitUntil(caches.open(CACHE).then(async c => {
    // Au mieux : un fichier injoignable n'empêche pas l'installation
    await Promise.all([PAGE, ...FICHIERS.map(f => new URL(f, PAGE).href)].map(u => c.add(u).catch(() => { })));
    await Promise.all(BIBLIOTHEQUES.map(u => fetch(u, { mode: "no-cors" }).then(r => c.put(u, r)).catch(() => { })));
  }).then(() => self.skipWaiting()));
});

self.addEventListener("activate", ev => {
  ev.waitUntil(caches.keys()
    .then(k => Promise.all(k.filter(n => n.startsWith("frais-") && n !== CACHE).map(n => caches.delete(n))))
    .then(() => self.clients.claim()));
});

const avecDelai = (promesse, ms) => new Promise((ok, ko) => {
  const t = setTimeout(() => ko(new Error("délai")), ms);
  promesse.then(r => { clearTimeout(t); ok(r); }, e => { clearTimeout(t); ko(e); });
});

self.addEventListener("fetch", ev => {
  const req = ev.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  // Page de l'application : réseau d'abord (5 s maximum), sinon la dernière copie
  if (req.mode === "navigate" && url.origin === location.origin) {
    ev.respondWith((async () => {
      const c = await caches.open(CACHE);
      try {
        const r = await avecDelai(fetch(req), 5000);
        if (r.ok) c.put(PAGE, r.clone());
        return r;
      } catch (e) {
        return (await c.match(PAGE)) || Response.error();
      }
    })());
    return;
  }

  const fichierLocal = url.origin === location.origin && FICHIERS.some(f => url.pathname.endsWith("/" + f));
  if (!fichierLocal && !HOTES_BIBLIOTHEQUES.includes(url.hostname)) return; // tout le reste : pas d'interception

  // Copie locale d'abord ; les fichiers locaux sont rafraîchis en arrière-plan
  ev.respondWith((async () => {
    const c = await caches.open(CACHE);
    const enCache = await c.match(req, { ignoreSearch: fichierLocal });
    const reseau = fetch(req).then(r => { if (r.ok || r.type === "opaque") c.put(req, r.clone()); return r; });
    if (enCache) { if (fichierLocal) ev.waitUntil(reseau.catch(() => { })); return enCache; }
    return reseau;
  })());
});
