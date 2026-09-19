"use strict";

const CACHE_TTL = 6 * 60 * 60 * 1000;

function normalize(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR')
    .replace(/[^a-z0-9]+/g, ' ').trim();
}

function similarity(query, candidate) {
  const a = normalize(query);
  const b = normalize(candidate);
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.includes(b) || b.includes(a)) return Math.min(a.length, b.length) / Math.max(a.length, b.length) * .9;
  const left = new Set(a.split(' '));
  const right = new Set(b.split(' '));
  const intersection = [...left].filter(token => right.has(token)).length;
  return intersection / new Set([...left, ...right]).size;
}

function createJikan({ fetchImpl = fetch } = {}) {
  const cache = new Map();
  let queue = Promise.resolve();
  let nextRequest = 0;

  async function lookup(title) {
    title = String(title || '').trim().slice(0, 120);
    if (!title) return null;
    const cacheKey = normalize(title);
    const cached = cache.get(cacheKey);
    if (cached?.expires > Date.now()) return cached.value;

    const slot = queue.then(async () => {
      await new Promise(resolve => setTimeout(resolve, Math.max(0, nextRequest - Date.now())));
      nextRequest = Date.now() + 450;
    });
    queue = slot.catch(() => {});
    await slot;

    try {
      const params = new URLSearchParams({ q: title, limit: '5', sfw: 'true', order_by: 'members', sort: 'desc' });
      const response = await fetchImpl('https://api.jikan.moe/v4/manga?' + params, {
        redirect: 'error', signal: AbortSignal.timeout(12000), headers: { Accept: 'application/json', 'User-Agent': 'NEXUS/1.0' }
      });
      if (!response.ok) return null;
      const payload = await response.json();
      const candidates = Array.isArray(payload?.data) ? payload.data : [];
      let best = null;
      let bestScore = 0;
      for (const item of candidates) {
        const titles = [item.title, item.title_english, item.title_japanese, ...(item.titles || []).map(entry => entry?.title)].filter(Boolean);
        const score = Math.max(...titles.map(candidate => similarity(title, candidate)));
        if (score > bestScore) { best = item; bestScore = score; }
      }
      if (!best || bestScore < .72) return null;
      const manga = {
        id: Number(best.mal_id), title: best.title_english || best.title,
        status: best.status || '', chapters: Number(best.chapters) || null, volumes: Number(best.volumes) || null,
        releaseYear: Number(best.published?.prop?.from?.year) || null,
        genres: [...(best.genres || []), ...(best.themes || [])].map(item => item?.name).filter(Boolean),
        authors: (best.authors || []).map(item => item?.name).filter(Boolean), synopsis: best.synopsis || '',
        score: Number(best.score) || null, url: best.url || '', matchScore: bestScore
      };
      cache.set(cacheKey, { value: manga, expires: Date.now() + CACHE_TTL });
      if (cache.size > 300) cache.delete(cache.keys().next().value);
      return manga;
    } catch {
      return null;
    }
  }

  return { lookup };
}

module.exports = { createJikan };
