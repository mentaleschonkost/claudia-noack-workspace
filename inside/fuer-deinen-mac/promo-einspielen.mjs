// Spielt die Promo-Einstellungen in worker.js ein – einmalig, im inside-Ordner ausführen:
//
//   node promo-einspielen.mjs
//
// • legt vorher eine Sicherung an (worker.js.vor-promo.bak)
// • ändert nichts, wenn die Erweiterung schon drin ist
// • bricht ohne Änderung ab, wenn worker.js nicht wie erwartet aussieht
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const hier = path.dirname(fileURLToPath(import.meta.url));
const ziel = path.join(process.cwd(), "worker.js");
const zusatzDatei = path.join(hier, "promo-api.js");
const WEICHE = 'if (p.startsWith("/api/promo/")) return await apiPromo(p, request, env, sess);';
const ANKER = /^([ \t]*)if\s*\(\s*p\.startsWith\(\s*["'`]\/api\/summraum\/["'`]\s*\)\s*\)\s*return\s+await\s+apiSummraum\([^)]*\)\s*;?[ \t]*$/m;

function stopp(text) {
  console.error("\n✗ " + text + "\n  worker.js wurde NICHT verändert.\n");
  process.exit(1);
}

if (!fs.existsSync(ziel)) stopp("Keine worker.js im aktuellen Ordner gefunden. Bitte im inside-Ordner ausführen.");
if (!fs.existsSync(zusatzDatei)) stopp("promo-api.js fehlt neben diesem Skript.");

const alt = fs.readFileSync(ziel, "utf8");
const zusatz = fs.readFileSync(zusatzDatei, "utf8");
const hatWeiche = alt.includes("/api/promo/");
const hatFunktion = /function\s+apiPromo\s*\(/.test(alt);

if (hatWeiche && hatFunktion) {
  console.log("✓ Die Promo-Erweiterung ist schon eingespielt. Nichts zu tun.");
  process.exit(0);
}
if (hatWeiche !== hatFunktion) stopp("worker.js enthält die Promo-Erweiterung nur halb. Bitte die Sicherung prüfen oder Claude fragen.");

const treffer = alt.match(new RegExp(ANKER.source, "gm")) || [];
if (treffer.length !== 1) stopp("Die Zeile mit /api/summraum/ wurde " + treffer.length + "× gefunden (erwartet: 1).");
for (const name of ["sb", "json", "enc", "ladeBereiche", "hatZugang"]) {
  if (!new RegExp("function\\s+" + name + "\\s*\\(").test(alt)) stopp("Die Hilfsfunktion " + name + "() fehlt in worker.js.");
}

const neu = alt.replace(ANKER, (zeile, einzug) => zeile + "\n" + einzug + WEICHE)
  + (alt.endsWith("\n") ? "" : "\n") + "\n" + zusatz;

fs.writeFileSync(ziel + ".vor-promo.bak", alt);
fs.writeFileSync(ziel, neu);
console.log("✓ Promo-Erweiterung eingespielt.");
console.log("  Sicherung: worker.js.vor-promo.bak");
console.log("  Jetzt:     npx wrangler deploy");
