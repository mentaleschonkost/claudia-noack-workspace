# Promo-Seiten in inside – Update „Quickfinder + Bildmaterial“

Alles in diesem Ordner gehört in deinen **inside-Ordner auf dem Mac** (dort, wo `worker.js`
und der Ordner `public` liegen). Die Login-Logik wird nicht verändert.

## Schon erledigt (in Supabase)

- Tabelle `ms_promo_einstellungen` (YouTube-Link, Preis, Gegenleistung)
- Tabelle `ms_promo_bilder` + privater Speicher `promo-bilder` (Bildmaterial)
- Bereiche: `promo-maedelsabend`, `promo-signatur`, `promo-hueterin`, `promo-events`

## Deine 3 Schritte

1. **Kopieren:** Den Inhalt dieses Ordners in deinen inside-Ordner kopieren und die
   vorhandenen Dateien ersetzen (`promo-api.js`, `promo-einspielen.mjs`,
   `public/promo-maedelsabend/index.html`).

2. **Einspielen** – im Terminal, im inside-Ordner:
   ```
   node promo-einspielen.mjs
   ```
   Beim Update erscheint „✓ Promo-Erweiterung aktualisiert (jetzt mit Bildmaterial)“.
   Vorher wird automatisch eine Sicherung `worker.js.vor-promo-bilder.bak` angelegt.
   Passt etwas nicht, bricht das Skript ab und ändert nichts.

3. **Hochladen:**
   ```
   npx wrangler deploy
   ```

## Danach

- Promo-Seite als Admin öffnen → gelber Kasten → **Bildmaterial hochladen**:
  Grafik(en) auswählen, optional Bildunterschrift („Feed-Post quadratisch“), **Hochladen**.
- Jede Grafik hat für dich einen **Löschen**-Knopf; Partnerinnen sehen nur **Herunterladen**.
- Ohne Bilder bleiben „Bildmaterial“ im Quickfinder und der Bereich für Partnerinnen ausgeblendet –
  genauso wie das Video ohne YouTube-Link.
- Erlaubt: JPG, PNG, WebP, GIF bis 15 MB pro Bild.

## Woran sehe ich, ob es eingespielt ist?

```
grep -c "promo-bilder" worker.js
```
Eine Zahl größer als 0 = eingespielt. Solange es fehlt, erscheint beim Hochladen eine Fehlermeldung.

## Zurück zum vorigen Stand

`worker.js.vor-promo-bilder.bak` wieder in `worker.js` umbenennen und `npx wrangler deploy`.
