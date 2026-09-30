// ─── Promo-Einstellungen ─────────────────────────────────────────────
// Ans Ende von worker.js anhängen. Nutzt die vorhandenen Helfer
// sb, json, enc, ladeBereiche, hatZugang, speicher und istUuid – die Login-Logik bleibt unverändert.
//
// GET    /api/promo/<slug>              → Einstellungen lesen (Admin oder freigeschaltete Person)
// PUT    /api/promo/<slug>              → Einstellungen speichern (nur Admin)
// GET    /api/promo/<slug>/bilder       → Bildmaterial auflisten
// GET    /api/promo/<slug>/bild/<id>    → Bild ausliefern (?download=1 zum Herunterladen)
// POST   /api/promo/<slug>/bild         → Bild hochladen (nur Admin)
// DELETE /api/promo/<slug>/bild         → Bild löschen (nur Admin, Body {id})
var PROMO_FELDER = ["youtube_link", "preis", "gegenleistung"];
var PROMO_BUCKET = "promo-bilder";
var PROMO_MAX_BILD = 15 * 1024 * 1024;
var PROMO_BILDTYPEN = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif" };
async function apiPromo(p, request, env, sess) {
  const m = request.method;
  const teile = p.slice("/api/promo/".length).replace(/\/+$/, "").split("/");
  const slug = decodeURIComponent(teile[0] || "");
  const art = teile[1] || "";
  const bildId = teile[2] || "";
  if (!/^promo-[a-z0-9-]+$/.test(slug)) return json({ error: "Unbekannter Bereich." }, 404);
  const admin = !!sess.person.ist_admin;
  if (!admin) {
    const b = (await ladeBereiche(env)).find((x) => x.slug === slug);
    if (!b || !b.aktiv || !(await hatZugang(env, sess.person.id, slug))) return json({ error: "Kein Zugriff." }, 403);
  }
  const nurAdmin = () => json({ error: "Kein Zugriff." }, 403);

  if (art === "" && teile.length === 1) {
    if (m === "GET") {
      const r = await sb(env, "ms_promo_einstellungen?slug=eq." + enc(slug) + "&select=youtube_link,preis,gegenleistung");
      const e = Array.isArray(r) && r[0] ? r[0] : {};
      return json({ youtube_link: e.youtube_link || "", preis: e.preis || "", gegenleistung: e.gegenleistung || "" });
    }
    if (m === "PUT") {
      if (!admin) return nurAdmin();
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
  }

  if (art === "bilder" && teile.length === 2 && m === "GET") {
    const r = await sb(env, "ms_promo_bilder?slug=eq." + enc(slug) + "&select=id,name,unterschrift,mime,groesse&order=erstellt_am.asc");
    return json({ bilder: Array.isArray(r) ? r : [] });
  }

  if (art === "bild" && teile.length === 3 && m === "GET") {
    if (!istUuid(bildId)) return json({ error: "Bild nicht gefunden." }, 404);
    const r = await sb(env, "ms_promo_bilder?id=eq." + enc(bildId) + "&slug=eq." + enc(slug) + "&select=pfad,mime,name");
    if (!Array.isArray(r) || !r.length) return json({ error: "Bild nicht gefunden." }, 404);
    const base = (env.SUPABASE_URL || "").replace(/\/$/, "");
    const res = await fetch(base + "/storage/v1/object/" + PROMO_BUCKET + "/" + r[0].pfad, {
      headers: { apikey: env.SUPABASE_SERVICE_KEY, Authorization: "Bearer " + env.SUPABASE_SERVICE_KEY }
    });
    if (!res.ok) return json({ error: "Bild nicht gefunden." }, 404);
    const kopf = {
      "content-type": r[0].mime,
      "cache-control": "private, max-age=86400",
      "x-content-type-options": "nosniff",
      "x-robots-tag": "noindex, nofollow"
    };
    if (new URL(request.url).searchParams.get("download") === "1") {
      const datei = r[0].name.replace(/[^\w.\- ]+/g, "_");
      kopf["content-disposition"] = "attachment; filename=\"" + datei + "\"; filename*=UTF-8''" + encodeURIComponent(r[0].name);
    }
    return new Response(res.body, { headers: kopf });
  }

  if (art === "bild" && teile.length === 2 && m === "POST") {
    if (!admin) return nurAdmin();
    const mime = (request.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
    if (!PROMO_BILDTYPEN[mime]) return json({ error: "Bitte nur Bilder (JPG, PNG, WebP, GIF)." }, 400);
    if (Number(request.headers.get("content-length") || 0) > PROMO_MAX_BILD) return json({ error: "Das Bild ist größer als 15 MB." }, 413);
    const daten = await request.arrayBuffer();
    if (!daten.byteLength) return json({ error: "Die Datei ist leer." }, 400);
    if (daten.byteLength > PROMO_MAX_BILD) return json({ error: "Das Bild ist größer als 15 MB." }, 413);
    const lesen = (k, fallback) => {
      let v = request.headers.get(k) || "";
      try { v = decodeURIComponent(v); } catch {}
      return v.replace(/[\u0000-\u001f]/g, "").trim().slice(0, 200) || fallback;
    };
    const name = lesen("x-dateiname", "Bild." + PROMO_BILDTYPEN[mime]);
    const unterschrift = lesen("x-unterschrift", null);
    const id = crypto.randomUUID();
    const pfad = slug + "/" + id + "." + PROMO_BILDTYPEN[mime];
    await speicher(env, "POST", "object/" + PROMO_BUCKET + "/" + pfad, daten, mime);
    try {
      await sb(env, "ms_promo_bilder", {
        method: "POST",
        body: { id, slug, name, unterschrift, pfad, mime, groesse: daten.byteLength }
      });
    } catch (e) {
      await speicher(env, "DELETE", "object/" + PROMO_BUCKET, JSON.stringify({ prefixes: [pfad] }), "application/json").catch(() => {});
      throw e;
    }
    return json({ ok: true, bild: { id, name, unterschrift, mime, groesse: daten.byteLength } });
  }

  if (art === "bild" && teile.length === 2 && m === "DELETE") {
    if (!admin) return nurAdmin();
    const b = await request.json().catch(() => ({}));
    if (!istUuid(b.id)) return json({ error: "id fehlt." }, 400);
    const r = await sb(env, "ms_promo_bilder?id=eq." + enc(b.id) + "&slug=eq." + enc(slug) + "&select=pfad");
    if (Array.isArray(r) && r.length) {
      await speicher(env, "DELETE", "object/" + PROMO_BUCKET, JSON.stringify({ prefixes: [r[0].pfad] }), "application/json");
      await sb(env, "ms_promo_bilder?id=eq." + enc(b.id) + "&slug=eq." + enc(slug), { method: "DELETE" });
    }
    return json({ ok: true });
  }

  return json({ error: "Unbekannter Endpunkt." }, 404);
}
