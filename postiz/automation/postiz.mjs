#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
//  postiz.mjs – Posts für Postiz per Befehl oder aus einer Wochenplan-Tabelle
//
//  Braucht nur Node.js (ab Version 18), keine weiteren Pakete.
//  Hilfe:  node postiz.mjs hilfe
// ─────────────────────────────────────────────────────────────────────────────
import { readFile, stat } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { basename, dirname, extname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

// ── Zugangsdaten ────────────────────────────────────────────────────────────
// Reihenfolge: Umgebungsvariablen > automation/zugang.env
export function loadConfig(env = process.env, file = join(HERE, 'zugang.env')) {
  const fromFile = {};
  if (existsSync(file)) {
    for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/);
      if (m) fromFile[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  }
  const url = (env.POSTIZ_URL || fromFile.POSTIZ_URL || 'http://localhost:4007').replace(/\/+$/, '');
  const apiKey = env.POSTIZ_API_KEY || fromFile.POSTIZ_API_KEY || '';
  // Selbst gehostet: <URL>/api/public/v1 · Postiz-Cloud: https://api.postiz.com/public/v1
  const apiBase = url.includes('api.postiz.com') ? `${url}/public/v1` : `${url}/api/public/v1`;
  return { url, apiKey, apiBase };
}

export class PostizError extends Error {}

export function createClient({ apiBase, apiKey }, fetchImpl = globalThis.fetch) {
  if (!apiKey) {
    throw new PostizError(
      'Kein API-Schlüssel gefunden.\n' +
        '→ In Postiz: Einstellungen → Developers → API Key → "Kopieren"\n' +
        '→ In die Datei automation/zugang.env eintragen: POSTIZ_API_KEY=dein-schlüssel'
    );
  }
  async function call(method, path, body, isForm = false) {
    let res;
    try {
      res = await fetchImpl(apiBase + path, {
        method,
        headers: {
          Authorization: apiKey,
          ...(body && !isForm ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body ? (isForm ? body : JSON.stringify(body)) : undefined,
      });
    } catch (err) {
      throw new PostizError(
        `Postiz ist nicht erreichbar (${apiBase}).\n` +
          '→ Läuft Postiz? Im Ordner postiz: docker compose ps\n' +
          `→ Stimmt POSTIZ_URL in zugang.env? (${err.cause?.code || err.message})`
      );
    }
    const text = await res.text();
    let data;
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      data = { raw: text };
    }
    if (!res.ok) {
      const msg = data?.msg || data?.message || data?.error || text || res.statusText;
      const hint =
        res.status === 401
          ? '\n→ API-Schlüssel falsch oder abgelaufen. Neu kopieren: Postiz → Einstellungen → Developers → API Key'
          : res.status === 502 || res.status === 503
            ? '\n→ Postiz startet gerade noch. 1–2 Minuten warten und erneut versuchen.'
          : res.status === 429
            ? '\n→ Zu viele Posts in einer Stunde. Später erneut versuchen oder API_LIMIT in .env erhöhen.'
            : '';
      throw new PostizError(`Postiz meldet Fehler ${res.status}: ${Array.isArray(msg) ? msg.join(', ') : typeof msg === 'string' ? msg : JSON.stringify(msg)}${hint}`);
    }
    return data;
  }
  return {
    isConnected: () => call('GET', '/is-connected'),
    integrations: () => call('GET', '/integrations'),
    posts: (startDate, endDate) =>
      call('GET', `/posts?startDate=${encodeURIComponent(startDate)}&endDate=${encodeURIComponent(endDate)}`),
    createPost: (payload) => call('POST', '/posts', payload),
    deletePost: (id) => call('DELETE', `/posts/${encodeURIComponent(id)}`),
    findSlot: (integrationId) => call('GET', `/find-slot/${encodeURIComponent(integrationId)}`),
    uploadFromUrl: (url) => call('POST', '/upload-from-url', { url }),
    uploadFile: async (filePath) => {
      const buf = await readFile(filePath);
      const type = MIME[extname(filePath).toLowerCase()] || 'application/octet-stream';
      const form = new FormData();
      form.append('file', new Blob([buf], { type }), basename(filePath));
      return call('POST', '/upload', form, true);
    },
  };
}

const MIME = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif',
  '.webp': 'image/webp', '.mp4': 'video/mp4', '.mov': 'video/quicktime',
};

// ── Plattform-Standards, damit ein einfacher Text-Post überall durchgeht ────
export function defaultSettings(identifier, text) {
  const firstLine = (text || '').split('\n')[0].slice(0, 100) || 'Neues Video';
  switch (identifier) {
    case 'instagram':
    case 'instagram-standalone':
      return { post_type: 'post' };
    case 'facebook':
      return { post_type: 'post' };
    case 'youtube':
      return { title: firstLine, type: 'public' };
    case 'tiktok':
      return {
        privacy_level: 'PUBLIC_TO_EVERYONE', duet: false, stitch: false, comment: true,
        autoAddMusic: 'no', brand_content_toggle: false, brand_organic_toggle: false,
        content_posting_method: 'DIRECT_POST',
      };
    case 'x':
      return { who_can_reply_post: 'everyone' };
    default:
      return {};
  }
}

// Diese Plattformen veröffentlichen nur mit Bild oder Video
const MEDIA_REQUIRED = { instagram: 'Instagram', 'instagram-standalone': 'Instagram', tiktok: 'TikTok', youtube: 'YouTube', pinterest: 'Pinterest' };
export function checkMedia(channels, mediaCount, type) {
  if (type === 'draft' || mediaCount > 0) return;
  const needs = [...new Set(channels.map((c) => MEDIA_REQUIRED[c.identifier]).filter(Boolean))];
  if (needs.length) throw new PostizError(`${needs.join(' und ')} braucht immer ein Bild oder Video (Spalte "bild" bzw. --bild).`);
}

// ── Kanäle finden: per ID, Name oder Plattform ("instagram", "alle") ───────
export function resolveChannels(spec, integrations) {
  const active = integrations.filter((i) => !i.disabled);
  const wanted = String(spec || '').split(/[,|]/).map((s) => s.trim()).filter(Boolean);
  if (!wanted.length) throw new PostizError('Kein Kanal angegeben (z. B. --kanal instagram oder --kanal alle).');
  const out = new Map();
  for (const w of wanted) {
    const lw = w.toLowerCase();
    const hits =
      lw === 'alle' || lw === 'all'
        ? active
        : active.filter(
            (i) =>
              i.id === w ||
              i.name?.toLowerCase() === lw ||
              i.identifier?.toLowerCase() === lw ||
              i.identifier?.toLowerCase().startsWith(lw + '-')
          );
    if (!hits.length) {
      const list = active.map((i) => `${i.identifier} (${i.name})`).join(', ') || 'noch keine';
      throw new PostizError(`Kanal "${w}" nicht gefunden. Verbundene Kanäle: ${list}`);
    }
    hits.forEach((h) => out.set(h.id, h));
  }
  return [...out.values()];
}

// ── Datum: "2026-10-05 09:30", "05.10.2026 09:30", ISO – in deiner Ortszeit ─
export function parseDate(datum, uhrzeit = '') {
  const s = `${datum || ''} ${uhrzeit || ''}`.trim();
  if (!s) return null;
  let m = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{2,4})(?:[ T](\d{1,2}):(\d{2}))?$/);
  if (m) {
    const y = m[3].length === 2 ? 2000 + +m[3] : +m[3];
    return checkDate(new Date(y, m[2] - 1, +m[1], +(m[4] || 9), +(m[5] || 0)), s);
  }
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{1,2}):(\d{2}))?$/);
  if (m) return checkDate(new Date(+m[1], m[2] - 1, +m[3], +(m[4] || 9), +(m[5] || 0)), s);
  const d = new Date(s);
  return checkDate(d, s);
}
function checkDate(d, raw) {
  if (Number.isNaN(d.getTime())) {
    throw new PostizError(`Datum "${raw}" nicht verstanden. Beispiele: 05.10.2026 09:30 oder 2026-10-05 09:30`);
  }
  return d;
}

// ── CSV (Excel-freundlich: Semikolon oder Komma, Anführungszeichen, Umbrüche) ─
export function parseCsv(text) {
  text = text.replace(/^﻿/, '');
  const firstLine = text.split(/\r?\n/, 1)[0];
  const sep = (firstLine.match(/;/g) || []).length >= (firstLine.match(/,/g) || []).length ? ';' : ',';
  const rows = [];
  let row = [], field = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') q = false;
      else field += c;
    } else if (c === '"' && field === '') q = true; // nur am Feldanfang, sonst normales Zeichen (z. B. JSON)
    else if (c === sep) { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  const nonEmpty = rows.filter((r) => r.some((f) => f.trim() !== ''));
  if (!nonEmpty.length) return [];
  const header = nonEmpty[0].map((h) => h.trim().toLowerCase());
  return nonEmpty.slice(1).map((r, idx) => {
    const obj = { _zeile: idx + 2 };
    header.forEach((h, i) => (obj[h] = (r[i] ?? '').trim()));
    return obj;
  });
}

// ── Einen Post-Auftrag (Payload) bauen ─────────────────────────────────────
export function buildPayload({ channels, text, date, media = [], type = 'schedule', settings = {}, kommentare = [] }) {
  if (!text?.trim() && !media.length) throw new PostizError('Der Post braucht Text oder ein Bild.');
  const value = [
    { content: text || '', image: media.map((m) => ({ id: m.id, path: m.path })) },
    ...kommentare.filter(Boolean).map((c) => ({ content: c, image: [] })),
  ];
  return {
    type,
    date: (date || new Date()).toISOString(),
    shortLink: false,
    tags: [],
    posts: channels.map((ch) => ({
      integration: { id: ch.id },
      value,
      settings: { ...defaultSettings(ch.identifier, text), ...settings },
    })),
  };
}

async function uploadMedia(client, refs, baseDir) {
  const out = [];
  for (const ref of refs) {
    if (/^https?:\/\//i.test(ref)) out.push(await client.uploadFromUrl(ref));
    else {
      const p = isAbsolute(ref) ? ref : resolve(baseDir, ref);
      try { await stat(p); } catch { throw new PostizError(`Bild/Video nicht gefunden: ${p}`); }
      out.push(await client.uploadFile(p));
    }
  }
  return out;
}

const splitList = (s) => String(s || '').split('|').map((x) => x.trim()).filter(Boolean);
const fmt = (d) => new Date(d).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' });

// ── Befehle ────────────────────────────────────────────────────────────────
export async function run(argv, { client: injected, log = console.log, config = loadConfig() } = {}) {
  const [cmd = 'hilfe', ...rest] = argv;
  const { args, flags } = parseArgs(rest);
  if (['hilfe', 'help', '-h', '--help'].includes(cmd)) return log(HELP);
  const client = injected || createClient(config);

  switch (cmd) {
    case 'check': {
      await client.isConnected();
      const ints = await client.integrations();
      log(`VERBINDUNG_OK – ${config.url} · ${ints.length} Kanal/Kanäle verbunden`);
      return;
    }
    case 'kanaele':
    case 'kanäle':
    case 'channels': {
      const ints = await client.integrations();
      if (!ints.length) return log('Noch keine Kanäle verbunden. In Postiz links auf "Kanal hinzufügen" klicken.');
      log('Plattform             Name                           ID');
      for (const i of ints) {
        log(`${(i.identifier + (i.disabled ? ' (aus)' : '')).padEnd(22)}${(i.name || '').slice(0, 30).padEnd(31)}${i.id}`);
      }
      return;
    }
    case 'post': {
      const text = flags.text ?? args.join(' ');
      const channels = resolveChannels(flags.kanal, await client.integrations());
      const date = flags.jetzt ? new Date() : parseDate(flags.zeit) || null;
      const type = flags.entwurf ? 'draft' : flags.jetzt ? 'now' : 'schedule';
      let when = date;
      if (!when) {
        // Keine Zeit angegeben → nächster freier Zeitplatz des ersten Kanals
        when = new Date((await client.findSlot(channels[0].id)).date);
      }
      checkMedia(channels, splitList(flags.bild).length, type);
      const media = await uploadMedia(client, splitList(flags.bild), process.cwd());
      const settings = flags.einstellungen ? JSON.parse(flags.einstellungen) : {};
      const payload = buildPayload({ channels, text, date: when, media, type, settings, kommentare: splitList(flags.kommentar) });
      if (flags.probe) return log(JSON.stringify(payload, null, 2));
      await client.createPost(payload);
      log(`✓ ${type === 'draft' ? 'Entwurf gespeichert' : type === 'now' ? 'Wird jetzt veröffentlicht' : 'Geplant für ' + fmt(when)} → ${channels.map((c) => c.name).join(', ')}`);
      return;
    }
    case 'plan': {
      const file = args[0];
      if (!file) throw new PostizError('Welche Datei? Beispiel: node postiz.mjs plan wochenplan.csv');
      const ab = Number(flags.ab || 0);
      const rows = parseCsv(await readFile(file, 'utf8')).filter((r) => r._zeile >= ab);
      if (!rows.length) throw new PostizError(`${file} enthält keine Posts.`);
      const ints = await client.integrations();
      const now = Date.now();
      // Erst ALLES prüfen, dann erst anlegen → nie ein halb eingespielter Plan
      const jobs = rows.map((r) => {
        try {
          const date = parseDate(r.datum, r.uhrzeit);
          if (!date) throw new PostizError('Spalte "datum" ist leer.');
          if (date.getTime() < now - 60_000 && r.typ !== 'entwurf') throw new PostizError(`${fmt(date)} liegt in der Vergangenheit.`);
          if (!r.text?.trim() && !r.bild?.trim()) throw new PostizError('Text und Bild sind beide leer.');
          for (const ref of splitList(r.bild)) {
            if (!/^https?:\/\//i.test(ref) && !existsSync(isAbsolute(ref) ? ref : resolve(dirname(resolve(file)), ref))) {
              throw new PostizError(`Bild/Video "${ref}" nicht gefunden (Pfad relativ zur Tabelle).`);
            }
          }
          const channels = resolveChannels(r.kanaele || r.kanal, ints);
          checkMedia(channels, splitList(r.bild).length, r.typ === 'entwurf' ? 'draft' : 'schedule');
          return {
            r, date, channels,
            settings: r.einstellungen ? JSON.parse(r.einstellungen) : {},
          };
        } catch (e) {
          throw new PostizError(`Zeile ${r._zeile}: ${e.message}`);
        }
      });
      log(`${jobs.length} Post(s) geprüft – alles in Ordnung.`);
      for (const j of jobs) {
        const type = j.r.typ === 'entwurf' ? 'draft' : 'schedule';
        if (flags.probe) {
          log(`  [Probe] ${fmt(j.date)} → ${j.channels.map((c) => c.name).join(', ')}: ${j.r.text.slice(0, 50).replace(/\n/g, ' ')}…`);
          continue;
        }
        try {
          const media = await uploadMedia(client, splitList(j.r.bild), dirname(resolve(file)));
          await client.createPost(buildPayload({ channels: j.channels, text: j.r.text, date: j.date, media, type, settings: j.settings, kommentare: splitList(j.r.kommentar) }));
        } catch (e) {
          const done = jobs.slice(0, jobs.indexOf(j)).map((x) => x.r._zeile);
          throw new PostizError(
            `Zeile ${j.r._zeile}: ${e.message}\n` +
              (done.length ? `Bereits eingeplant: Zeile ${done.join(', ')}. ` : 'Es wurde nichts eingeplant. ') +
              `Nach dem Korrigieren weitermachen mit:  node postiz.mjs plan ${file} --ab ${j.r._zeile}`
          );
        }
        log(`  ✓ ${fmt(j.date)} → ${j.channels.map((c) => c.name).join(', ')}`);
      }
      log(flags.probe ? 'Probelauf – nichts angelegt. Ohne --probe wirklich einplanen.' : 'Fertig – alles steht im Postiz-Kalender.');
      return;
    }
    case 'liste':
    case 'list': {
      const tage = Number(flags.tage || 7);
      const start = new Date();
      const end = new Date(start.getTime() + tage * 86400000);
      const { posts = [] } = await client.posts(start.toISOString(), end.toISOString());
      if (!posts.length) return log(`Keine Posts in den nächsten ${tage} Tagen.`);
      posts.sort((a, b) => new Date(a.publishDate) - new Date(b.publishDate));
      for (const p of posts) {
        const plain = String(p.content || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
        log(`${fmt(p.publishDate)}  ${(p.integration?.name || '').padEnd(20).slice(0, 20)}  ${(p.state || '').padEnd(9)}  ${plain.slice(0, 50)}  [${p.id}]`);
      }
      return;
    }
    case 'loeschen':
    case 'löschen':
    case 'delete': {
      if (!args[0]) throw new PostizError('Welche Post-ID? Die steht bei "liste" in [eckigen Klammern].');
      await client.deletePost(args[0]);
      return log('✓ Gelöscht.');
    }
    default:
      throw new PostizError(`Unbekannter Befehl "${cmd}". Hilfe: node postiz.mjs hilfe`);
  }
}

export function parseArgs(list) {
  const args = [], flags = {};
  for (let i = 0; i < list.length; i++) {
    const a = list[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = list[i + 1];
      if (next === undefined || next.startsWith('--')) flags[key] = true;
      else { flags[key] = next; i++; }
    } else args.push(a);
  }
  return { args, flags };
}

const HELP = `
Postiz-Automatisierung – Befehle
────────────────────────────────
  node postiz.mjs check                 Verbindung testen
  node postiz.mjs kanaele               Verbundene Kanäle anzeigen
  node postiz.mjs post --kanal instagram --zeit "05.10.2026 09:30" --text "Hallo 🌙"
        --kanal     instagram | linkedin | alle | Name | ID  (mehrere: "instagram,linkedin")
        --zeit      weglassen = nächster freier Zeitplatz
        --jetzt     sofort veröffentlichen
        --entwurf   nur als Entwurf speichern
        --bild      Datei oder Link (mehrere mit | trennen)
        --kommentar erster Kommentar (z. B. Hashtags), mehrere mit |
        --probe     nur anzeigen, nichts senden
  node postiz.mjs plan wochenplan.csv [--probe]   Ganze Tabelle einplanen
        --ab 5      erst ab Zeile 5 (nach einem Fehler weitermachen)
  node postiz.mjs liste [--tage 14]     Geplante Posts anzeigen
  node postiz.mjs loeschen <ID>         Post löschen
`;

// ── Start von der Kommandozeile ───────────────────────────────────────────
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  run(process.argv.slice(2)).catch((e) => {
    console.error('✗ ' + (e instanceof PostizError ? e.message : e.stack || e));
    process.exit(1);
  });
}
