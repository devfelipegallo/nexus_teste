"use strict";

const MAX_IMAGE_BYTES = 32 * 1024 * 1024;

function serviceError(status, message, code, upstreamStatus) {
  return Object.assign(new Error(message), { status, code, upstreamStatus });
}

function createKomga({ env = process.env, fetchImpl = fetch } = {}) {
  const rawUrl = env.KOMGA_URL?.trim();
  const username = env.KOMGA_USERNAME?.trim();
  const password = env.KOMGA_PASSWORD?.trim();
  let baseUrl = null;

  if (rawUrl) {
    try {
      const parsed = new URL(rawUrl);
      if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) throw new Error();
      parsed.pathname = parsed.pathname.replace(/\/$/, '');
      parsed.search = '';
      parsed.hash = '';
      baseUrl = parsed.href.replace(/\/$/, '');
    } catch { baseUrl = null; }
  }

  const configured = Boolean(baseUrl && username && password);
  const authorization = configured ? 'Basic ' + Buffer.from(`${username}:${password}`).toString('base64') : null;

  function requireConfiguration() {
    if (!configured) throw serviceError(503, 'Configure KOMGA_URL, KOMGA_USERNAME e KOMGA_PASSWORD no arquivo .env.', 'KOMGA_NOT_CONFIGURED');
  }

  async function upstream(pathname, options = {}) {
    requireConfiguration();
    let response;
    try {
      response = await fetchImpl(baseUrl + pathname, {
        ...options,
        redirect: 'error',
        signal: AbortSignal.timeout(12000),
        headers: {
          Accept: 'application/json',
          Authorization: authorization,
          ...(options.body ? { 'Content-Type': 'application/json' } : {}),
          ...options.headers
        }
      });
    } catch {
      throw serviceError(503, 'Não foi possível conectar ao Komga. Confirme se o serviço está iniciado.', 'KOMGA_UNAVAILABLE');
    }
    if (response.status === 401 || response.status === 403)
      throw serviceError(502, 'O Komga recusou as credenciais configuradas.', 'KOMGA_AUTH', response.status);
    if (!response.ok)
      throw serviceError(502, `O Komga respondeu com erro ${response.status}.`, 'KOMGA_RESPONSE', response.status);
    return response;
  }

  async function json(pathname, options) {
    const response = await upstream(pathname, options);
    try { return await response.json(); }
    catch { throw serviceError(502, 'O Komga retornou uma resposta inválida.', 'KOMGA_RESPONSE'); }
  }

  function normalizePage(data) {
    if (Array.isArray(data)) return { content: data, totalElements: data.length, totalPages: 1, number: 0, last: true };
    return {
      content: Array.isArray(data?.content) ? data.content : [],
      totalElements: Number(data?.totalElements) || 0,
      totalPages: Number(data?.totalPages) || 0,
      number: Number(data?.number) || 0,
      last: Boolean(data?.last)
    };
  }

  function seriesItem(item) {
    const metadata = item?.metadata || {};
    return {
      id: String(item.id),
      title: metadata.title || item.name || 'Série sem título',
      summary: metadata.summary || '',
      status: metadata.status || '',
      releaseYear: Number(String(metadata.releaseDate || metadata.createdDate || '').slice(0, 4)) || null,
      booksCount: Number(item.booksCount) || 0,
      booksReadCount: Number(item.booksReadCount) || 0,
      booksInProgressCount: Number(item.booksInProgressCount) || 0,
      genres: Array.isArray(metadata.genres) ? metadata.genres.slice(0, 5) : [],
      authors: Array.isArray(metadata.authors) ? metadata.authors.map(author => author?.name).filter(Boolean).slice(0, 4) : [],
      thumbnailUrl: `/api/komga/series/${encodeURIComponent(item.id)}/thumbnail`
      ,contentRating: 'unknown', addedAt: metadata.createdDate || item.createdDate || null
    };
  }

  function bookItem(item) {
    const metadata = item?.metadata || {};
    return {
      id: String(item.id),
      seriesId: String(item.seriesId || ''),
      title: metadata.title || item.name || `Capítulo ${metadata.number || item.number || ''}`.trim(),
      number: metadata.number || String(item.number || ''),
      volume: metadata.number || String(item.number || ''),
      chapter: metadata.number || String(item.number || ''),
      pagesCount: Number(item.media?.pagesCount) || 0,
      mediaType: item.media?.mediaType || '',
      completed: Boolean(item.readProgress?.completed),
      currentPage: Number(item.readProgress?.page) || 0,
      thumbnailUrl: `/api/komga/books/${encodeURIComponent(item.id)}/thumbnail`
    };
  }

  async function listSeries({ search = '', page = 0, size = 30 } = {}) {
    page = Math.max(0, Math.min(10000, Number(page) || 0));
    size = Math.max(1, Math.min(60, Number(size) || 30));
    search = String(search || '').trim().slice(0, 120);
    const params = new URLSearchParams({ page: String(page), size: String(size), sort: 'metadata.titleSort,asc' });
    if (search) params.set('search', search);
    const result = normalizePage(await json('/api/v1/series?' + params));
    return { ...result, content: result.content.map(seriesItem) };
  }

  async function getSeries(seriesId) {
    return seriesItem(await json(`/api/v1/series/${encodeURIComponent(seriesId)}`));
  }

  async function listBooks(seriesId) {
    const params = new URLSearchParams({ unpaged: 'true', sort: 'metadata.numberSort,asc' });
    const result = normalizePage(await json(`/api/v1/series/${encodeURIComponent(seriesId)}/books?${params}`));
    return result.content.map(bookItem);
  }

  async function listPages(bookId) {
    const data = await json(`/api/v1/books/${encodeURIComponent(bookId)}/pages`);
    const pages = Array.isArray(data) ? data : Array.isArray(data?.content) ? data.content : [];
    return pages.map((page, index) => ({
      number: Number(page?.number) || index + 1,
      width: Number(page?.width) || null,
      height: Number(page?.height) || null,
      mediaType: page?.mediaType || null
    }));
  }

  async function image(pathname) {
    const response = await upstream(pathname, { headers: { Accept: 'image/avif,image/webp,image/png,image/jpeg,image/*' } });
    const type = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
    if (!type?.startsWith('image/')) throw serviceError(502, 'O Komga não retornou uma imagem válida.', 'KOMGA_RESPONSE');
    const length = Number(response.headers.get('content-length'));
    if (Number.isFinite(length) && length > MAX_IMAGE_BYTES) throw serviceError(413, 'A imagem do Komga é muito grande.', 'KOMGA_IMAGE_TOO_LARGE');
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > MAX_IMAGE_BYTES) throw serviceError(413, 'A imagem do Komga é muito grande.', 'KOMGA_IMAGE_TOO_LARGE');
    return { buffer, type, etag: response.headers.get('etag') };
  }

  async function status() {
    if (!configured) return { configured: false, connected: false };
    try {
      const result = await listSeries({ size: 1 });
      return { configured: true, connected: true, seriesCount: result.totalElements };
    } catch (error) {
      return { configured: true, connected: false, code: error.code, message: error.message };
    }
  }

  return { configured, status, listSeries, getSeries, listBooks, listPages, image };
}

module.exports = { createKomga };
