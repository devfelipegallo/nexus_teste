'use strict';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const error = (status, message) => Object.assign(new Error(message), { status });
const id = value => { if (!UUID.test(value)) throw error(400, 'Identificador de mangá inválido.'); return value; };
const integer = (value, fallback, max) => Math.min(max, Math.max(0, Math.floor(Number(value) || fallback)));
const language = value => ['pt-br', 'pt', 'en', 'es', 'ja'].includes(value) ? value : 'pt-br';
const localized = value => value?.['pt-br'] || value?.pt || value?.en || Object.values(value || {})[0] || '';

function createMangaDex({ fetchImpl = fetch } = {}) {
  const cache = new Map();
  let queue = Promise.resolve();
  let nextRequest = 0;
  async function request(url, image = false) {
    // Limit outgoing requests, including images, across all local sessions.
    const slot = queue.then(async () => {
      await new Promise(resolve => setTimeout(resolve, Math.max(0, nextRequest - Date.now())));
      nextRequest = Date.now() + 260;
    });
    queue = slot.catch(() => {});
    await slot;
    let response;
    try {
      response = await fetchImpl(url, { redirect: 'error', signal: AbortSignal.timeout(20000), headers: {
        Accept: image ? 'image/*' : 'application/json', 'User-Agent': 'Nexus-MangaDex/1.0'
      } });
    } catch { throw error(503, 'Não foi possível conectar ao MangaDex. Tente novamente.'); }
    if (response.status === 429) {
      nextRequest = Date.now() + Math.min(120, Math.max(1, Number(response.headers.get('retry-after')) || 10)) * 1000;
      throw error(429, 'Limite do MangaDex atingido. Aguarde um pouco e tente novamente.');
    }
    if (!response.ok) throw error(response.status === 404 ? 404 : 502, `O MangaDex respondeu com erro ${response.status}.`);
    return response;
  }
  async function json(path) {
    const existing = cache.get(path);
    if (existing?.expires > Date.now()) return existing.promise;
    const promise = request('https://api.mangadex.org' + path).then(response => response.json()).catch(cause => {
      cache.delete(path);
      throw cause.status ? cause : error(502, 'Resposta inválida do MangaDex.');
    });
    cache.set(path, { promise, expires: Date.now() + 60000 });
    if (cache.size > 200) cache.delete(cache.keys().next().value);
    return promise;
  }
  function seriesItem(item) {
    const a = item.attributes || {};
    return { id: item.id, title: localized(a.title) || 'Sem título', summary: localized(a.description),
      status: a.status || '', releaseYear: Number(a.year) || null, authors: (item.relationships || []).filter(r => r.type === 'author').map(r => r.attributes?.name).filter(Boolean),
      genres: (a.tags || []).map(t => localized(t.attributes?.name)), booksCount: null, booksReadCount: 0,
      contentRating: a.contentRating || 'unknown', addedAt: a.createdAt || a.updatedAt || null,
      thumbnailUrl: `/api/mangadex/series/${item.id}/thumbnail`, sourceUrl: `https://mangadex.org/title/${item.id}` };
  }
  async function listSeries({ search = '', page = 0, size = 30, lang, ratings = ['safe', 'suggestive'] } = {}) {
    size = Math.max(1, integer(size, 30, 60));
    const offset = integer(page, 0, Math.floor((10000 - size) / size)) * size;
    const p = new URLSearchParams({ limit: size, offset, 'includes[]': 'author', 'order[createdAt]': 'desc', 'availableTranslatedLanguage[]': language(lang) });
    for (const rating of ratings) p.append('contentRating[]', rating);
    if (String(search).trim()) p.set('title', String(search).trim().slice(0, 120));
    p.append('includes[]', 'cover_art');
    const result = await json('/manga?' + p);
    for (const item of result.data || []) {
      cache.set(`/manga/${item.id}?includes[]=cover_art`, { promise: Promise.resolve({ data: item }), expires: Date.now() + 60000 });
      if (cache.size > 200) cache.delete(cache.keys().next().value);
    }
    return { content: (result.data || []).map(seriesItem), totalElements: result.total || 0, last: offset + size >= Math.min(result.total || 0, Math.floor(10000 / size) * size) };
  }
  async function getSeries(seriesId) {
    const result = await json(`/manga/${id(seriesId)}?includes[]=author&includes[]=cover_art`);
    if (!result.data) throw error(404, 'Mangá não encontrado.');
    return seriesItem(result.data);
  }
  async function listBooks(seriesId, { lang, offset = 0 } = {}) {
    id(seriesId);
    offset = integer(offset, 0, 9900);
    const p = new URLSearchParams({ limit: 100, offset, 'translatedLanguage[]': language(lang), 'order[chapter]': 'asc', 'order[volume]': 'asc', includeExternalUrl: '0', includeFuturePublishAt: '0' });
    const data = await json(`/manga/${seriesId}/feed?${p}`);
    return { total: data.total || 0, nextOffset: offset + 100 < Math.min(data.total || 0, 10000) ? offset + 100 : null,
      books: (data.data || []).filter(item => !item.attributes.externalUrl && item.attributes.pages > 0).map(item => {
        const a = item.attributes;
        return { id: item.id, title: a.title || (a.chapter ? `Capítulo ${a.chapter}` : 'Capítulo'),
          volume: a.volume || null, chapter: a.chapter || null, pagesCount: a.pages,
          thumbnailUrl: `/api/mangadex/series/${seriesId}/thumbnail`, sourceUrl: `https://mangadex.org/chapter/${item.id}` };
      }) };
  }
  async function chapter(chapterId) {
    const result = await json(`/at-home/server/${id(chapterId)}`);
    const base = new URL(result.baseUrl);
    if (base.protocol !== 'https:' || base.username || base.password || base.port || !/(^|\.)mangadex\.(org|network)$/.test(base.hostname)) throw error(502, 'Servidor de páginas inválido.');
    if (!Array.isArray(result.chapter?.data) || !/^[a-z0-9]+$/i.test(result.chapter.hash)) throw error(502, 'Capítulo indisponível.');
    return result;
  }
  async function listPages(chapterId) {
    const data = await chapter(chapterId);
    return data.chapter.data.map((_, i) => ({ number: i + 1 }));
  }
  async function imageBuffer(url) {
    const response = await request(url, true);
    const type = response.headers.get('content-type')?.split(';')[0];
    if (!['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif'].includes(type)) throw error(502, 'Imagem inválida do MangaDex.');
    const chunks = []; let size = 0;
    for await (const chunk of response.body) {
      size += chunk.length;
      if (size > 32 * 1024 * 1024) throw error(413, 'Imagem muito grande.');
      chunks.push(chunk);
    }
    return { type, buffer: Buffer.concat(chunks) };
  }
  async function cover(seriesId) {
    const data = await json(`/manga/${id(seriesId)}?includes[]=cover_art`);
    const file = data.data?.relationships?.find(r => r.type === 'cover_art')?.attributes?.fileName;
    if (!file) throw error(404, 'Capa indisponível.');
    return imageBuffer(`https://uploads.mangadex.org/covers/${seriesId}/${encodeURIComponent(file)}.256.jpg`);
  }
  async function pageImage(chapterId, number) {
    const data = await chapter(chapterId);
    const file = data.chapter.data[Number(number) - 1];
    if (!file) throw error(404, 'Página indisponível.');
    return imageBuffer(`${data.baseUrl}/data/${data.chapter.hash}/${encodeURIComponent(file)}`);
  }
  return { listSeries, getSeries, listBooks, listPages, cover, pageImage };
}
module.exports = { createMangaDex };
