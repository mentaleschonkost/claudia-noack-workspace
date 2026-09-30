# Promo-Einstellungen in inside einbauen (einmalig)

Damit kannst du als Admin auf jeder Promo-Seite YouTube-Link, Preis und Gegenleistung
selbst eintragen – ohne Claude. Die Login-Logik wird dabei nicht verändert.

## 1. Datenbank – erledigt

Die Tabelle `ms_promo_einstellungen` ist in Supabase (Projekt „Frequenz“) bereits angelegt
(`promo-einstellungen.sql`). Bestehende Tabellen wurden nicht verändert.

## 2. worker.js ergänzen (2 Stellen)

Öffne `worker.js` in deinem inside-Ordner.

**Stelle A** – suche diese Zeile:

```js
  if (p.startsWith("/api/summraum/")) return await apiSummraum(p, request, env, sess);
```

und füge **direkt darunter** eine neue Zeile ein:

```js
  if (p.startsWith("/api/promo/")) return await apiPromo(p, request, env, sess);
```

**Stelle B** – kopiere den kompletten Inhalt von `promo-api.js` ganz ans **Ende** von `worker.js`.

## 3. Hochladen

Wie gewohnt im inside-Ordner:

```
npx wrangler deploy
```

## 4. Nutzen

1. Promo-Ordner (z. B. `public/promo-maedelsabend/`) hochladen und im Admin den Bereich
   mit demselben Kürzel anlegen – das Kürzel muss mit `promo-` beginnen.
2. Die Promo-Seite öffnen, während du als Admin angemeldet bist: Oben im gelben Kasten
   steht „Einstellungen für diesen Bereich“. Link/Preis/Gegenleistung eintragen, **Speichern**.
3. Ohne YouTube-Link wird der Video-Bereich für Partnerinnen automatisch ausgeblendet.

## Falls etwas nicht klappt

- Im gelben Kasten steht „Einstellungen konnten nicht geladen werden“ → Schritt 2/3 fehlt noch.
- Beim Speichern erscheint ein Fehler mit „Supabase 409“ o. ä. → der Bereich ist im Admin
  noch nicht angelegt (Kürzel muss exakt dem Ordnernamen entsprechen).
- Zurück zum alten Stand: die zwei Ergänzungen aus `worker.js` entfernen und neu deployen.
  Die Tabelle stört nicht; sie kann bleiben.
