# Promo-Seiten in inside – einmal einspielen

Alles in diesem Ordner gehört in deinen **inside-Ordner auf dem Mac** (dort, wo `worker.js`
und der Ordner `public` liegen). Die Login-Logik wird nicht verändert.

## Schon erledigt (in Supabase)

- Tabelle `ms_promo_einstellungen` angelegt
- Bereiche angelegt: `promo-maedelsabend`, `promo-signatur`, `promo-hueterin`, `promo-events`
  (Namen kannst du im Admin ändern; freigeschaltet ist noch niemand)

## Deine 3 Schritte

1. **Kopieren:** Den Inhalt dieses Ordners in deinen inside-Ordner kopieren.
   - `public/promo-maedelsabend/index.html` landet in deinem (bisher leeren) Ordner
   - `promo-einspielen.mjs`, `promo-api.js` liegen dann neben `worker.js`
     (`promo-einstellungen.sql` und diese Datei sind nur zur Dokumentation)

2. **Einspielen** – im Terminal, im inside-Ordner:
   ```
   node promo-einspielen.mjs
   ```
   Es erscheint „✓ Promo-Erweiterung eingespielt“. Vorher wird automatisch eine Sicherung
   `worker.js.vor-promo.bak` angelegt. Passt etwas nicht, bricht das Skript ab und ändert nichts.

3. **Hochladen:**
   ```
   npx wrangler deploy
   ```

## Danach

- Öffne `https://inside.mentale-schonkost.de/promo-maedelsabend/` (als Admin angemeldet).
- Oben im gelben Kasten: **Einstellungen** – YouTube-Link, Preis, Gegenleistung eintragen, **Speichern**.
- Partnerin im Admin für `promo-maedelsabend` freischalten – sie wird mit Vornamen begrüßt.
- Ohne YouTube-Link bleibt der Video-Bereich für Partnerinnen ausgeblendet.

## Zurück zum alten Stand

`worker.js.vor-promo.bak` wieder in `worker.js` umbenennen und `npx wrangler deploy`.

## Warum nicht Claude direkt deployt hat

Ein Deploy braucht die vollständige Liste aller inside-Dateien (Login, Start, Admin, Summraum …).
Die gibt es nur auf deinem Mac – ein Deploy von außen hätte diese Seiten gelöscht, und dein
nächster eigener Deploy hätte die Erweiterung wieder überschrieben.
