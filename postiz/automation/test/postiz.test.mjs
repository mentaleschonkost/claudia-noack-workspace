// Tests gegen einen nachgebauten Postiz-Server: node --test automation/test
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  run, createClient, parseCsv, parseDate, resolveChannels, buildPayload, loadConfig, PostizError,
} from '../postiz.mjs';

const INTEGRATIONS = [
  { id: 'ig1', name: 'mentaleschonkost', identifier: 'instagram', disabled: false },
  { id: 'fb1', name: 'Mentale Schonkost', identifier: 'facebook', disabled: false },
  { id: 'li1', name: 'Claudia Noack', identifier: 'linkedin', disabled: false },
  { id: 'lp1', name: 'Schonkost Page', identifier: 'linkedin-page', disabled: false },
  { id: 'x1', name: 'alt', identifier: 'x', disabled: true },
];

let server, base, calls;
before(async () => {
  server = createServer((req, res) => {
    let body = [];
    req.on('data', (c) => body.push(c));
    req.on('end', () => {
      body = Buffer.concat(body);
      calls.push({ method: req.method, url: req.url, auth: req.headers.authorization, type: req.headers['content-type'], body });
      const send = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
      if (req.headers.authorization !== 'good-key') return send(401, { msg: 'Invalid API key' });
      const u = req.url.replace('/api/public/v1', '');
      if (u === '/is-connected') return send(200, { connected: true });
      if (u === '/integrations') return send(200, INTEGRATIONS);
      if (u.startsWith('/find-slot/')) return send(200, { date: '2030-01-01T10:00:00.000Z' });
      if (u === '/upload') return send(201, { id: 'm1', path: 'http://localhost:4007/uploads/a.jpg' });
      if (u === '/upload-from-url') return send(201, { id: 'm2', path: 'http://localhost:4007/uploads/b.jpg' });
      if (u === '/posts' && req.method === 'POST') {
        const p = JSON.parse(body);
        if (p.posts.some((x) => x.value[0].content.includes('FEHLER'))) return send(400, { msg: 'post is too long, please fix it' });
        return send(201, [{ postId: 'p1', integration: p.posts[0].integration.id }]);
      }
      if (u.startsWith('/posts?')) return send(200, { posts: [{ id: 'p9', content: '<p>Hallo <b>Welt</b></p>', publishDate: '2030-01-02T08:00:00Z', state: 'QUEUE', integration: { name: 'mentaleschonkost' } }] });
      if (u.startsWith('/posts/') && req.method === 'DELETE') return send(200, { error: false });
      send(404, { msg: 'not found' });
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

const cfg = (key = 'good-key') => ({ url: base, apiKey: key, apiBase: `${base}/api/public/v1` });
async function exec(argv, key) {
  calls = [];
  const out = [];
  await run(argv, { config: cfg(key), log: (s) => out.push(s) });
  return out.join('\n');
}
const posted = () => calls.filter((c) => c.method === 'POST' && c.url.endsWith('/posts')).map((c) => JSON.parse(c.body));

test('check meldet VERBINDUNG_OK und schickt den API-Schlüssel', async () => {
  const out = await exec(['check']);
  assert.match(out, /VERBINDUNG_OK/);
  assert.ok(calls.every((c) => c.auth === 'good-key'));
});

test('falscher Schlüssel → verständliche deutsche Fehlermeldung', async () => {
  await assert.rejects(exec(['check'], 'bad'), /API-Schlüssel falsch/);
});

test('fehlender Schlüssel → Hinweis wo man ihn findet', () => {
  assert.throws(() => createClient({ apiBase: 'x', apiKey: '' }), /Developers/);
});

test('Postiz nicht erreichbar → Hinweis statt Absturz', async () => {
  const c = createClient({ apiBase: 'http://127.0.0.1:1/api/public/v1', apiKey: 'k' });
  await assert.rejects(c.isConnected(), /nicht erreichbar/);
});

test('kanaele listet alle Kanäle', async () => {
  const out = await exec(['kanaele']);
  assert.match(out, /instagram\s+mentaleschonkost\s+ig1/);
  assert.match(out, /x \(aus\)/);
});

test('post an instagram mit Zeit, Bild-Upload und Erstkommentar', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'pz-'));
  const img = join(dir, 'bild.jpg');
  await writeFile(img, Buffer.from([0xff, 0xd8, 0xff]));
  const out = await exec(['post', '--kanal', 'instagram', '--zeit', '05.10.2030 09:30', '--text', 'Hallo 🌙', '--bild', img, '--kommentar', '#achtsamkeit']);
  assert.match(out, /Geplant für 05\.10\.30, 09:30 → mentaleschonkost/);
  const up = calls.find((c) => c.url.endsWith('/upload'));
  assert.match(up.type, /multipart\/form-data/);
  const [p] = posted();
  assert.equal(p.type, 'schedule');
  assert.equal(p.shortLink, false);
  assert.equal(new Date(p.date).getTime(), new Date(2030, 9, 5, 9, 30).getTime());
  assert.deepEqual(p.posts[0].settings, { post_type: 'post' });
  assert.deepEqual(p.posts[0].value[0].image, [{ id: 'm1', path: 'http://localhost:4007/uploads/a.jpg' }]);
  assert.equal(p.posts[0].value[1].content, '#achtsamkeit');
});

test('post ohne Zeit nutzt den nächsten freien Zeitplatz', async () => {
  await exec(['post', '--kanal', 'linkedin', '--text', 'Hi']);
  assert.ok(calls.some((c) => c.url.includes('/find-slot/li1')));
  assert.equal(posted()[0].date, '2030-01-01T10:00:00.000Z');
});

test('"linkedin" trifft Profil UND Seite, "alle" nur aktive Kanäle', () => {
  assert.deepEqual(resolveChannels('linkedin', INTEGRATIONS).map((c) => c.id), ['li1', 'lp1']);
  assert.deepEqual(resolveChannels('alle', INTEGRATIONS).map((c) => c.id), ['ig1', 'fb1', 'li1', 'lp1']);
  assert.throws(() => resolveChannels('tiktok', INTEGRATIONS), /nicht gefunden.*instagram/);
});

test('--entwurf, --jetzt und --probe', async () => {
  await exec(['post', '--kanal', 'facebook', '--text', 'x', '--entwurf']);
  assert.equal(posted()[0].type, 'draft');
  await exec(['post', '--kanal', 'facebook', '--text', 'x', '--jetzt']);
  assert.equal(posted()[0].type, 'now');
  const out = await exec(['post', '--kanal', 'facebook', '--text', 'x', '--zeit', '2030-01-01 10:00', '--probe']);
  assert.equal(posted().length, 0);
  assert.match(out, /"integration"/);
});

test('Postiz-Validierungsfehler wird durchgereicht', async () => {
  await assert.rejects(exec(['post', '--kanal', 'x1', '--text', 'a']), /nicht gefunden/); // deaktiviert
  await assert.rejects(exec(['post', '--kanal', 'facebook', '--text', 'FEHLER', '--zeit', '2030-01-01 10:00']), /too long/);
});

test('CSV: Semikolon, mehrzeilige Texte in Anführungszeichen, BOM', () => {
  const rows = parseCsv('﻿datum;text\n01.01.2030;"Zeile 1\nZeile ""2"""\n\n02.01.2030;b\n');
  assert.equal(rows.length, 2);
  assert.equal(rows[0].text, 'Zeile 1\nZeile "2"');
  assert.equal(rows[1]._zeile, 3);
  assert.equal(parseCsv('datum,text\n1,"a,b"')[0].text, 'a,b');
});

test('Datumsformate', () => {
  assert.equal(parseDate('05.10.2030', '09:30').getTime(), new Date(2030, 9, 5, 9, 30).getTime());
  assert.equal(parseDate('2030-10-05 18:05').getTime(), new Date(2030, 9, 5, 18, 5).getTime());
  assert.equal(parseDate('05.10.30').getHours(), 9); // ohne Uhrzeit → 9 Uhr
  assert.throws(() => parseDate('morgen'), /nicht verstanden/);
});

test('plan: Vorlage wird komplett eingeplant (Probe + echt)', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'pz-'));
  const csv = join(dir, 'plan.csv');
  await writeFile(csv, 'datum;uhrzeit;kanaele;text;bild;kommentar;typ;einstellungen\n' +
    '06.10.2030;08:30;instagram,facebook;"Text\nzwei";https://example.com/a.jpg;#tag;;\n' +
    '08.10.2030;12:00;linkedin;Hallo;;;;{"post_as_images_carousel":false}\n' +
    '10.10.2030;18:00;alle;Entwurf;;;entwurf;\n');
  let out = await exec(['plan', csv, '--probe']);
  assert.match(out, /3 Post\(s\) geprüft/);
  assert.equal(posted().length, 0);
  out = await exec(['plan', csv]);
  const ps = posted();
  assert.equal(ps.length, 3);
  assert.deepEqual(ps[0].posts.map((p) => p.integration.id), ['ig1', 'fb1']);
  assert.equal(ps[0].posts[0].value[0].image[0].id, 'm2');
  assert.equal(ps[1].posts[0].settings.post_as_images_carousel, false);
  assert.equal(ps[2].type, 'draft');
  assert.equal(ps[2].posts.length, 4);
});

test('plan: ein Fehler in einer Zeile → NICHTS wird angelegt', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'pz-'));
  const csv = join(dir, 'plan.csv');
  await writeFile(csv, 'datum;kanaele;text\n06.10.2030 08:30;linkedin;ok\n01.01.2020 08:00;linkedin;alt\n');
  await assert.rejects(exec(['plan', csv]), /Zeile 3: .*Vergangenheit/);
  assert.equal(posted().length, 0);
});

test('plan: fehlendes Bild wird VOR dem Anlegen erkannt', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'pz-'));
  const csv = join(dir, 'plan.csv');
  await writeFile(join(dir, 'da.jpg'), 'x');
  await writeFile(csv, 'datum;kanaele;text;bild\n06.10.2030 08:30;instagram;ok;da.jpg\n07.10.2030 08:30;instagram;fehlt;weg.jpg\n');
  await assert.rejects(exec(['plan', csv]), /Zeile 3: .*weg\.jpg.*nicht gefunden/);
  assert.equal(posted().length, 0);
  assert.equal(calls.filter((c) => c.url.includes('/upload')).length, 0);
});

test('Instagram ohne Bild wird abgelehnt – außer als Entwurf', async () => {
  await assert.rejects(exec(['post', '--kanal', 'instagram,linkedin', '--text', 'x', '--zeit', '2030-01-01 10:00']), /Instagram braucht immer ein Bild/);
  assert.equal(posted().length, 0);
  await exec(['post', '--kanal', 'instagram', '--text', 'x', '--entwurf']);
  assert.equal(posted().length, 1);
  const dir = await mkdtemp(join(tmpdir(), 'pz-'));
  const csv = join(dir, 'plan.csv');
  await writeFile(csv, 'datum;kanaele;text;typ\n06.10.2030 08:30;linkedin;ok;\n07.10.2030 08:30;instagram;ohne bild;\n');
  await assert.rejects(exec(['plan', csv]), /Zeile 3: Instagram braucht/);
  assert.equal(posted().length, 0);
});

test('plan: Server-Fehler mittendrin → sagt was schon drin ist und wie es weitergeht (--ab)', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'pz-'));
  const csv = join(dir, 'plan.csv');
  await writeFile(csv, 'datum;kanaele;text\n06.10.2030 08:30;linkedin;eins\n07.10.2030 08:30;linkedin;FEHLER\n08.10.2030 08:30;linkedin;drei\n');
  await assert.rejects(exec(['plan', csv]), (e) => {
    assert.match(e.message, /Zeile 3: .*too long/);
    assert.match(e.message, /Bereits eingeplant: Zeile 2\./);
    assert.match(e.message, /--ab 3/);
    return true;
  });
  // "eins" angenommen, "FEHLER" abgelehnt, "drei" gar nicht erst versucht
  assert.deepEqual(posted().map((p) => p.posts[0].value[0].content), ['eins', 'FEHLER']);
  await writeFile(csv, 'datum;kanaele;text\n06.10.2030 08:30;linkedin;eins\n07.10.2030 08:30;linkedin;korrigiert\n08.10.2030 08:30;linkedin;drei\n');
  await exec(['plan', csv, '--ab', '3']);
  assert.deepEqual(posted().map((p) => p.posts[0].value[0].content), ['korrigiert', 'drei']);
});

test('liste zeigt Posts ohne HTML', async () => {
  const out = await exec(['liste', '--tage', '3']);
  assert.match(out, /mentaleschonkost.*QUEUE\s+Hallo Welt\s+\[p9\]/);
});

test('loeschen', async () => {
  const out = await exec(['loeschen', 'p9']);
  assert.match(out, /Gelöscht/);
  assert.ok(calls.some((c) => c.method === 'DELETE' && c.url.endsWith('/posts/p9')));
});

test('Konfiguration: zugang.env + Cloud-URL', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'pz-'));
  const f = join(dir, 'zugang.env');
  await writeFile(f, 'POSTIZ_URL=https://social.example.de/\nPOSTIZ_API_KEY="abc"\n');
  assert.deepEqual(loadConfig({}, f), { url: 'https://social.example.de', apiKey: 'abc', apiBase: 'https://social.example.de/api/public/v1' });
  assert.equal(loadConfig({ POSTIZ_URL: 'https://api.postiz.com', POSTIZ_API_KEY: 'k' }, f).apiBase, 'https://api.postiz.com/public/v1');
});

test('Payload ohne Text und Bild wird abgelehnt', () => {
  assert.throws(() => buildPayload({ channels: [INTEGRATIONS[0]], text: '' }), PostizError);
});
