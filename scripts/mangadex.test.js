'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createMangaDex } = require('../src/server/mangadex');
const { createServer } = require('../server');
const ID = '11111111-1111-4111-8111-111111111111';
const calls = [];
const json = data => new Response(JSON.stringify(data), { headers: { 'content-type': 'application/json' } });
async function fakeFetch(url) {
  calls.push(url);
  const u = new URL(url);
  if (u.pathname === '/manga') return json({ total: 90, data: [{ id: ID, attributes: { title: { en: 'Example', 'pt-br': 'Exemplo' }, description: { en: 'Summary' }, contentRating: 'safe', createdAt: '2026-01-01T00:00:00Z' }, relationships: [{ type: 'author', attributes: { name: 'Author' } }, { type: 'cover_art', attributes: { fileName: 'cover.jpg' } }] }] });
  if (u.pathname.endsWith('/feed')) return json({ total: 101, data: [
    { id: ID, attributes: { chapter: '1', pages: 2 }, relationships: [{ type: 'scanlation_group', attributes: { name: 'Grupo' } }] },
    { id: ID, attributes: { pages: 2, externalUrl: 'https://example.org' } }
  ] });
  if (u.pathname.startsWith('/at-home/')) return json({ baseUrl: 'https://uploads.mangadex.org', chapter: { hash: 'abc123', data: ['one.jpg', 'two.jpg'] } });
  if (u.hostname === 'uploads.mangadex.org') return new Response(Buffer.from([1, 2, 3]), { headers: { 'content-type': 'image/jpeg' } });
  throw new Error('Unexpected URL ' + url);
}
test('catalog language, pagination, normalization, cached cover and chapter credits', async () => {
  calls.length = 0;
  const service = createMangaDex({ fetchImpl: fakeFetch });
  const result = await service.listSeries({ search: 'A & B', page: 1, lang: 'pt-br' });
  assert.equal(result.content[0].title, 'Exemplo');
  assert.equal(result.last, false);
  const url = new URL(calls[0]);
  assert.equal(url.searchParams.get('title'), 'A & B');
  assert.equal(url.searchParams.get('offset'), '30');
  assert.equal(url.searchParams.get('availableTranslatedLanguage[]'), 'pt-br');
  await service.listSeries({ search: 'A & B', page: 1, lang: 'pt-br' });
  assert.equal(calls.length, 1);
  assert.equal((await service.cover(ID)).type, 'image/jpeg');
  assert.equal(calls.length, 2);
  const chapters = await service.listBooks(ID, { lang: 'en' });
  assert.equal(chapters.nextOffset, 100);
  assert.equal(chapters.books.length, 1);
  assert.equal(chapters.books[0].groups, undefined);
  assert.equal((await service.listPages(ID)).length, 2);
  assert.equal((await service.pageImage(ID, 2)).buffer.length, 3);
  await assert.rejects(service.pageImage(ID, 3), { status: 404 });
  await assert.rejects(service.listBooks('../secret'), { status: 400 });
});
test('rejects external page servers and upstream rate limits', async () => {
  const unsafe = createMangaDex({ fetchImpl: async () => json({ baseUrl: 'https://127.0.0.1', chapter: { hash: 'abc', data: ['one.jpg'] } }) });
  await assert.rejects(unsafe.listPages(ID), { status: 502 });
  const limited = createMangaDex({ fetchImpl: async () => new Response('', { status: 429 }) });
  await assert.rejects(limited.listSeries(), { status: 429 });
  const offline = createMangaDex({ fetchImpl: async () => { throw new Error('offline'); } });
  await assert.rejects(offline.listSeries(), { status: 503 });
});
test('HTTP integration requires session and supports catalog, chapters, images and method validation', async t => {
  const server = createServer({ databasePath: ':memory:', databaseOptions: { env: { NEXUS_ADMIN_PASSWORD: 'admin', NEXUS_SEED_DEMO: '1' }, logger: { warn() {} } }, mangadexOptions: { fetchImpl: fakeFetch } });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const base = `http://127.0.0.1:${server.address().port}`;
  assert.equal((await fetch(base + '/api/mangadex/series')).status, 401);
  const login = await fetch(base + '/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'user', password: '123' }) });
  const headers = { cookie: login.headers.get('set-cookie').split(';')[0] };
  const get = path => fetch(base + path, { headers });
  assert.equal((await (await get('/api/mangadex/series')).json()).content[0].title, 'Exemplo');
  assert.equal((await (await get(`/api/mangadex/series/${ID}/books`)).json()).books.length, 1);
  assert.equal((await (await get(`/api/mangadex/books/${ID}/pages`)).json()).pages.length, 2);
  assert.equal((await get(`/api/mangadex/books/${ID}/pages/1`)).headers.get('content-type'), 'image/jpeg');
  assert.equal((await get('/api/mangadex/series/invalid/books')).status, 400);
  assert.equal((await fetch(base + '/api/mangadex/series', { method: 'POST', headers })).status, 405);
  assert.equal((await get('/api/komga/status')).status, 200);
});
