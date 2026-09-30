// ─── Promo-Einstellungen ─────────────────────────────────────────────
// Ans Ende von worker.js anhängen. Nutzt die vorhandenen Helfer
// sb, json, enc, ladeBereiche und hatZugang – die Login-Logik bleibt unverändert.
//
// GET /api/promo/<slug>  → Einstellungen lesen (Admin oder freigeschaltete Person)
// PUT /api/promo/<slug>  → Einstellungen speichern (nur Admin)
var PROMO_FELDER = ["youtube_link", "preis", "gegenleistung"];
async function apiPromo(p, request, env, sess) {
  const m = request.method;
  const slug = decodeURIComponent(p.slice("/api/promo/".length)).replace(/\/+$/, "");
  if (!/^promo-[a-z0-9-]+$/.test(slug)) return json({ error: "Unbekannter Bereich." }, 404);
  if (!sess.person.ist_admin) {
    const b = (await ladeBereiche(env)).find((x) => x.slug === slug);
    if (!b || !b.aktiv || !(await hatZugang(env, sess.person.id, slug))) return json({ error: "Kein Zugriff." }, 403);
  }
  if (m === "GET") {
    const r = await sb(env, "ms_promo_einstellungen?slug=eq." + enc(slug) + "&select=youtube_link,preis,gegenleistung");
    const e = Array.isArray(r) && r[0] ? r[0] : {};
    return json({ youtube_link: e.youtube_link || "", preis: e.preis || "", gegenleistung: e.gegenleistung || "" });
  }
  if (m === "PUT") {
    if (!sess.person.ist_admin) return json({ error: "Kein Zugriff." }, 403);
    const body = await request.json().catch(() => ({}));
    const felder = { slug, aktualisiert_am: new Date().toISOString() };
    for (const k of PROMO_FELDER) felder[k] = String(body[k] || "").trim().slice(0, 500) || null;
    if (felder.youtube_link && !/^https:\/\/(www\.|m\.)?(youtube\.com|youtu\.be)\//.test(felder.youtube_link)) {
      return json({ error: "Bitte einen YouTube-Link eingeben (https://youtu.be/… oder https://www.youtube.com/…)." }, 400);
    }
    await sb(env, "ms_promo_einstellungen?on_conflict=slug", {
      method: "POST",
      prefer: "resolution=merge-duplicates",
      body: felder
    });
    return json({ ok: true });
  }
  return json({ error: "Unbekannter Endpunkt." }, 404);
}
