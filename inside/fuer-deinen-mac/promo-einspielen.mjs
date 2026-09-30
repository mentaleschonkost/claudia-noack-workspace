// Spielt die Promo-Erweiterung (Einstellungen + Bildmaterial) in worker.js ein.
// Im inside-Ordner ausführen:
//
//   node promo-einspielen.mjs
//
// • legt vorher eine Sicherung an (worker.js.vor-promo.bak bzw. worker.js.vor-promo-bilder.bak)
// • ersetzt eine ältere Promo-Erweiterung (nur Einstellungen) durch die neue
// • ändert nichts, wenn die aktuelle Version schon drin ist
// • bricht ohne Änderung ab, wenn worker.js nicht wie erwartet aussieht
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const hier = path.dirname(fileURLToPath(import.meta.url));
const ziel = path.join(process.cwd(), "worker.js");
const zusatzDatei = path.join(hier, "promo-api.js");
const WEICHE = 'if (p.startsWith("/api/promo/")) return await apiPromo(p, request, env, sess);';
const ANKER = /^([ \t]*)if\s*\(\s*p\.startsWith\(\s*["'`]\/api\/summraum\/["'`]\s*\)\s*\)\s*return\s+await\s+apiSummraum\([^)]*\)\s*;?[ \t]*$/m;
const MARKE = "// ─── Promo-Einstellungen";
const ALT_V1 = "// ─── Promo-Einstellungen ─────────────────────────────────────────────\n// Ans Ende von worker.js anhängen. Nutzt die vorhandenen Helfer\n// sb, json, enc, ladeBereiche und hatZugang – die Login-Logik bleibt unverändert.\n//\n// GET /api/promo/<slug>  → Einstellungen lesen (Admin oder freigeschaltete Person)\n// PUT /api/promo/<slug>  → Einstellungen speichern (nur Admin)\nvar PROMO_FELDER = [\"youtube_link\", \"preis\", \"gegenleistung\"];\nasync function apiPromo(p, request, env, sess) {\n  const m = request.method;\n  const slug = decodeURIComponent(p.slice(\"/api/promo/\".length)).replace(/\\/+$/, \"\");\n  if (!/^promo-[a-z0-9-]+$/.test(slug)) return json({ error: \"Unbekannter Bereich.\" }, 404);\n  if (!sess.person.ist_admin) {\n    const b = (await ladeBereiche(env)).find((x) => x.slug === slug);\n    if (!b || !b.aktiv || !(await hatZugang(env, sess.person.id, slug))) return json({ error: \"Kein Zugriff.\" }, 403);\n  }\n  if (m === \"GET\") {\n    const r = await sb(env, \"ms_promo_einstellungen?slug=eq.\" + enc(slug) + \"&select=youtube_link,preis,gegenleistung\");\n    const e = Array.isArray(r) && r[0] ? r[0] : {};\n    return json({ youtube_link: e.youtube_link || \"\", preis: e.preis || \"\", gegenleistung: e.gegenleistung || \"\" });\n  }\n  if (m === \"PUT\") {\n    if (!sess.person.ist_admin) return json({ error: \"Kein Zugriff.\" }, 403);\n    const body = await request.json().catch(() => ({}));\n    const felder = { slug, aktualisiert_am: new Date().toISOString() };\n    for (const k of PROMO_FELDER) felder[k] = String(body[k] || \"\").trim().slice(0, 500) || null;\n    if (felder.youtube_link && !/^https:\\/\\/(www\\.|m\\.)?(youtube\\.com|youtu\\.be)\\//.test(felder.youtube_link)) {\n      return json({ error: \"Bitte einen YouTube-Link eingeben (https://youtu.be/… oder https://www.youtube.com/…).\" }, 400);\n    }\n    await sb(env, \"ms_promo_einstellungen?on_conflict=slug\", {\n      method: \"POST\",\n      prefer: \"resolution=merge-duplicates\",\n      body: felder\n    });\n    return json({ ok: true });\n  }\n  return json({ error: \"Unbekannter Endpunkt.\" }, 404);\n}\n";

function stopp(text) {
  console.error("\n✗ " + text + "\n  worker.js wurde NICHT verändert.\n");
  process.exit(1);
}
const norm = (s) => s.replace(/\r\n/g, "\n").trim();

if (!fs.existsSync(ziel)) stopp("Keine worker.js im aktuellen Ordner gefunden. Bitte im inside-Ordner ausführen.");
if (!fs.existsSync(zusatzDatei)) stopp("promo-api.js fehlt neben diesem Skript.");

const alt = fs.readFileSync(ziel, "utf8");
const zusatz = fs.readFileSync(zusatzDatei, "utf8");
const hatWeiche = alt.includes('p.startsWith("/api/promo/")');
const markeAn = alt.indexOf(MARKE);

for (const name of ["sb", "json", "enc", "ladeBereiche", "hatZugang", "speicher", "istUuid"]) {
  if (!new RegExp("function\\s+" + name + "\\s*\\(").test(alt)) stopp("Die Hilfsfunktion " + name + "() fehlt in worker.js.");
}

// Fall 1: schon aktuell
if (hatWeiche && markeAn >= 0 && norm(alt.slice(markeAn)) === norm(zusatz)) {
  console.log("✓ Die aktuelle Promo-Erweiterung ist schon eingespielt. Nichts zu tun.");
  process.exit(0);
}

// Fall 2: ältere Version (nur Einstellungen) → Block am Dateiende ersetzen
if (hatWeiche && markeAn >= 0) {
  if (norm(alt.slice(markeAn)) !== norm(ALT_V1)) {
    stopp("Der Promo-Block am Ende von worker.js wurde verändert oder ist unbekannt – ich ersetze ihn nicht automatisch.");
  }
  const neu = alt.slice(0, markeAn) + zusatz;
  fs.writeFileSync(ziel + ".vor-promo-bilder.bak", alt);
  fs.writeFileSync(ziel, neu);
  console.log("✓ Promo-Erweiterung aktualisiert (jetzt mit Bildmaterial).");
  console.log("  Sicherung: worker.js.vor-promo-bilder.bak");
  console.log("  Jetzt:     npx wrangler deploy");
  process.exit(0);
}

// Fall 3: noch nichts eingespielt
if (hatWeiche || markeAn >= 0 || /function\s+apiPromo\s*\(/.test(alt)) {
  stopp("worker.js enthält die Promo-Erweiterung nur halb. Bitte die Sicherung prüfen oder Claude fragen.");
}
const treffer = alt.match(new RegExp(ANKER.source, "gm")) || [];
if (treffer.length !== 1) stopp("Die Zeile mit /api/summraum/ wurde " + treffer.length + "× gefunden (erwartet: 1).");
const neu = alt.replace(ANKER, (zeile, einzug) => zeile + "\n" + einzug + WEICHE)
  + (alt.endsWith("\n") ? "" : "\n") + "\n" + zusatz;
fs.writeFileSync(ziel + ".vor-promo.bak", alt);
fs.writeFileSync(ziel, neu);
console.log("✓ Promo-Erweiterung eingespielt.");
console.log("  Sicherung: worker.js.vor-promo.bak");
console.log("  Jetzt:     npx wrangler deploy");
