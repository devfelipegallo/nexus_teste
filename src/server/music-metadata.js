"use strict";

const SPOTIFY_GLOBAL_PLAYLIST = '37i9dQZEVXbMDoHDwVN2tF';
const IMAGE_HOSTS = ['i.scdn.co', 'mosaic.scdn.co', 'lastfm.freetls.fastly.net', 'lastfm-img.freetls.fastly.net', 'lastfm-img2.akamaized.net', 'userserve-ak.last.fm'];

function canonical(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/\([^)]*\)|\[[^\]]*\]/g, '').split(/\b(?:feat|ft)\.?\s/i)[0]
    .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}
function safeUrl(value, hosts) {
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || !hosts.includes(url.hostname)) return null;
    url.protocol = 'https:';
    return url.href;
  } catch { return null; }
}
function duration(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.round(number) : null;
}
function spotifyItem(item) {
  const artists = (item?.artists || []).map(artist => artist?.name).filter(name => typeof name === 'string' && name.trim());
  if (typeof item?.name !== 'string' || !artists.length) return null;
  return {
    title: item.name,
    artists,
    durationMs: duration(item.duration_ms),
    coverUrl: (item.album?.images || []).map(image => safeUrl(image?.url, IMAGE_HOSTS)).find(Boolean) || null,
    links: { spotify: safeUrl(item.external_urls?.spotify, ['open.spotify.com']), lastfm: null },
    source: 'spotify', kind: 'Música'
  };
}
function spotifyAlbum(item) {
  const artists = (item?.artists || []).map(artist => artist?.name).filter(name => typeof name === 'string' && name.trim());
  if (typeof item?.name !== 'string' || !artists.length) return null;
  return {
    title: item.name,
    artists,
    durationMs: null,
    coverUrl: (item.images || []).map(image => safeUrl(image?.url, IMAGE_HOSTS)).find(Boolean) || null,
    links: { spotify: safeUrl(item.external_urls?.spotify, ['open.spotify.com']), lastfm: null },
    source: 'spotify', kind: 'Álbum'
  };
}
function spotifyArtist(item) {
  if (typeof item?.name !== 'string') return null;
  return {
    title: item.name,
    artists: ['Artista'],
    durationMs: null,
    coverUrl: (item.images || []).map(image => safeUrl(image?.url, IMAGE_HOSTS)).find(Boolean) || null,
    links: { spotify: safeUrl(item.external_urls?.spotify, ['open.spotify.com']), lastfm: null },
    source: 'spotify', kind: 'Artista'
  };
}
function lastfmItem(item) {
  const artist = typeof item?.artist === 'string' ? item.artist : item?.artist?.name;
  if (typeof item?.name !== 'string' || typeof artist !== 'string' || !artist.trim()) return null;
  const images = Array.isArray(item.image) ? [...item.image].reverse() : Array.isArray(item.album?.image) ? [...item.album.image].reverse() : [];
  return {
    title: item.name,
    artists: [artist],
    durationMs: duration(item.duration),
    coverUrl: images.map(image => safeUrl(image?.['#text'], IMAGE_HOSTS)).find(Boolean) || null,
    links: { spotify: null, lastfm: safeUrl(item.url, ['www.last.fm', 'last.fm']) },
    source: 'lastfm'
  };
}
function exact(track, query) {
  return track && canonical(track.title) === canonical(query.track) && track.artists.some(artist => canonical(artist) === canonical(query.artist));
}

function createMusicMetadata({ env = process.env, fetchImpl = fetch, now = Date.now } = {}) {
  const config = {
    spotifyId: env.SPOTIFY_CLIENT_ID?.trim(),
    spotifySecret: env.SPOTIFY_CLIENT_SECRET?.trim(),
    lastfmKey: env.LASTFM_API_KEY?.trim(),
    market: /^[A-Z]{2}$/.test(env.SPOTIFY_MARKET || '') ? env.SPOTIFY_MARKET : 'BR'
  };
  const cache = new Map(), pending = new Map(), detailsCache = new Map();
  const cooldown = { spotify: 0, lastfm: 0 };
  let token = null, tokenExpires = 0, tokenPromise = null;

  function providerError(status) { return Object.assign(new Error(status), { providerStatus: status }); }
  async function request(provider, url, options = {}) {
    if (cooldown[provider] > now()) throw providerError('rate_limited');
    const response = await fetchImpl(url, { ...options, signal: AbortSignal.timeout(8000), redirect: 'error' });
    if (response.status === 429) {
      const retry = Math.max(1, Math.min(3600, Number(response.headers.get('retry-after')) || 60));
      cooldown[provider] = now() + retry * 1000;
      throw providerError('rate_limited');
    }
    if ([400, 401].includes(response.status)) throw providerError('invalid_credentials');
    if (response.status === 403) throw providerError('access_denied');
    if (!response.ok) throw providerError('unavailable');
    return response.json();
  }
  async function spotifyToken() {
    if (token && now() < tokenExpires) return token;
    if (!tokenPromise) {
      tokenPromise = (async () => {
        const data = await request('spotify', 'https://accounts.spotify.com/api/token', {
          method: 'POST',
          headers: {
            Authorization: 'Basic ' + Buffer.from(`${config.spotifyId}:${config.spotifySecret}`).toString('base64'),
            'Content-Type': 'application/x-www-form-urlencoded'
          },
          body: 'grant_type=client_credentials'
        });
        if (typeof data.access_token !== 'string') throw providerError('invalid_credentials');
        token = data.access_token;
        tokenExpires = now() + Math.max(1, (Number(data.expires_in) || 3600) - 60) * 1000;
        return token;
      })().finally(() => { tokenPromise = null; });
    }
    return tokenPromise;
  }
  async function spotifyRequest(url) {
    if (!config.spotifyId || !config.spotifySecret) throw providerError('not_configured');
    for (let attempt = 0; attempt < 2; attempt++) {
      try { return await request('spotify', url, { headers: { Authorization: 'Bearer ' + await spotifyToken() } }); }
      catch (error) {
        if (error.providerStatus !== 'invalid_credentials' || attempt === 1) throw error;
        token = null;
      }
    }
  }
  async function lastfmRequest(params) {
    if (!config.lastfmKey) throw providerError('not_configured');
    const url = new URL('https://ws.audioscrobbler.com/2.0/');
    url.search = new URLSearchParams({ ...params, api_key: config.lastfmKey, format: 'json' });
    const data = await request('lastfm', url);
    if (data.error) {
      if ([6, 7].includes(Number(data.error))) throw providerError('not_found');
      if ([4, 10, 26].includes(Number(data.error))) throw providerError('invalid_credentials');
      if (Number(data.error) === 29) { cooldown.lastfm = now() + 60000; throw providerError('rate_limited'); }
      throw providerError('unavailable');
    }
    return data;
  }
  async function lastfmPageCover(url) {
    if (!url) return null;
    const response = await fetchImpl(url, {
      signal: AbortSignal.timeout(8000),
      redirect: 'error',
      headers: { Accept: 'text/html', 'User-Agent': 'NEXUS/1.0' }
    });
    if (!response.ok) return null;
    const html = await response.text();
    const match = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)/i)
      || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i);
    const image = safeUrl(match?.[1], IMAGE_HOSTS);
    // O Last.fm usa esta arte genérica quando não possui capa; o cliente mostra
    // uma capa tipográfica própria, que é mais útil do que repetir a mesma estrela.
    return image && !/\/2a96cbd8b46e442fc41c2b86b821562f\.png(?:\?|$)/i.test(image) ? image : null;
  }
  async function guarded(fn) {
    try { return { status: 'ok', data: await fn() }; }
    catch (error) { return { status: error.providerStatus || 'unavailable', data: null }; }
  }
  async function lastfmDetails(track) {
    if (!track || track.coverUrl || !config.lastfmKey) return track;
    const key = canonical(track.artists[0] + '|' + track.title);
    if (!detailsCache.has(key)) {
      const task = (async () => {
        try {
          const [infoResult, coverResult] = await Promise.allSettled([
            lastfmRequest({ method: 'track.getInfo', artist: track.artists[0], track: track.title, autocorrect: '1' }),
            lastfmPageCover(track.links.lastfm)
          ]);
          const detail = infoResult.status === 'fulfilled' ? lastfmItem(infoResult.value.track) : null;
          const pageCover = coverResult.status === 'fulfilled' ? coverResult.value : null;
          const merged = detail ? {
            ...track,
            durationMs: track.durationMs || detail.durationMs,
            coverUrl: detail.coverUrl || pageCover || track.coverUrl,
            links: { spotify: track.links.spotify, lastfm: detail.links.lastfm || track.links.lastfm }
          } : track;
          if (!merged.coverUrl) merged.coverUrl = pageCover;
          return merged;
        } catch { return track; }
      })();
      detailsCache.set(key, task);
      if (detailsCache.size > 300) detailsCache.delete(detailsCache.keys().next().value);
    }
    return detailsCache.get(key);
  }
  async function enrichLastfm(tracks) {
    const enriched = [];
    for (let index = 0; index < tracks.length; index += 4) {
      enriched.push(...await Promise.all(tracks.slice(index, index + 4).map(lastfmDetails)));
    }
    return enriched;
  }
  function memo(key, ttl, task) {
    if (cache.get(key)?.expires > now()) return Promise.resolve(cache.get(key).value);
    if (pending.has(key)) return pending.get(key);
    if (pending.size >= 12) return Promise.reject(Object.assign(new Error('Muitas consultas. Tente novamente em instantes.'), { status: 429 }));
    const running = task().then(value => {
      if (cache.size >= 250) cache.delete(cache.keys().next().value);
      cache.set(key, { value, expires: now() + ttl });
      return value;
    }).finally(() => pending.delete(key));
    pending.set(key, running);
    return running;
  }
  async function lookup(query) {
    if (!query || typeof query.artist !== 'string' || typeof query.track !== 'string' || !query.artist.trim() || !query.track.trim() || query.artist.length > 160 || query.track.length > 200) {
      throw Object.assign(new Error('Informe artista e música válidos.'), { status: 400 });
    }
    query = { artist: query.artist.trim(), track: query.track.trim() };
    return memo('lookup:' + canonical(query.artist + ' ' + query.track), 600000, async () => {
      const spotifyUrl = new URL('https://api.spotify.com/v1/search');
      spotifyUrl.search = new URLSearchParams({ q: `track:${query.track} artist:${query.artist}`, type: 'track', limit: '5', market: config.market });
      const [sp, lf] = await Promise.all([
        guarded(async () => (await spotifyRequest(spotifyUrl)).tracks?.items?.map(spotifyItem).find(track => exact(track, query)) || null),
        guarded(async () => {
          const data = await lastfmRequest({ method: 'track.getInfo', artist: query.artist, track: query.track, autocorrect: '1' });
          const track = lastfmItem(data.track);
          return exact(track, query) ? await lastfmDetails(track) : null;
        })
      ]);
      if (sp.status === 'ok' && !sp.data) sp.status = 'not_found';
      if (lf.status === 'ok' && !lf.data) lf.status = 'not_found';
      const primary = sp.data || lf.data;
      return {
        metadata: primary ? {
          title: primary.title,
          artists: primary.artists,
          durationMs: sp.data?.durationMs || lf.data?.durationMs || null,
          coverUrl: sp.data?.coverUrl || lf.data?.coverUrl || null,
          links: { spotify: sp.data?.links.spotify || null, lastfm: lf.data?.links.lastfm || null }
        } : null,
        providers: { spotify: sp.status, lastfm: lf.status }
      };
    });
  }
  async function discover(limit = 12) {
    limit = Math.max(1, Math.min(20, Number(limit) || 12));
    return memo(`discover:${limit}`, 300000, async () => {
      const spotifyUrl = new URL(`https://api.spotify.com/v1/playlists/${SPOTIFY_GLOBAL_PLAYLIST}/items`);
      spotifyUrl.search = new URLSearchParams({ market: config.market, limit: String(limit) });
      const sp = await guarded(async () => (await spotifyRequest(spotifyUrl)).items?.map(entry => spotifyItem(entry?.item || entry?.track)).filter(Boolean) || []);
      return { tracks: (sp.data || []).slice(0, limit), source: sp.data?.length ? 'spotify' : null, providers: { spotify: sp.status } };
    });
  }
  async function searchCatalog(query, limit = 12) {
    if (typeof query !== 'string' || !query.trim() || query.trim().length > 120) throw Object.assign(new Error('Informe uma busca válida.'), { status: 400 });
    query = query.trim();
    limit = Math.max(1, Math.min(20, Number(limit) || 12));
    return memo(`search:${canonical(query)}:${limit}`, 300000, async () => {
      const spotifyUrl = new URL('https://api.spotify.com/v1/search');
      const perType = Math.max(3, Math.ceil(limit / 3));
      spotifyUrl.search = new URLSearchParams({ q: query, type: 'track,artist,album', limit: String(perType), market: config.market });
      const sp = await guarded(async () => {
        const data = await spotifyRequest(spotifyUrl);
        const groups = [
          ...(data.tracks?.items || []).map(spotifyItem),
          ...(data.artists?.items || []).map(spotifyArtist),
          ...(data.albums?.items || []).map(spotifyAlbum)
        ].filter(Boolean);
        return groups.slice(0, limit);
      });
      return { tracks: sp.data || [], source: sp.data?.length ? 'spotify' : null, providers: { spotify: sp.status } };
    });
  }
  return { lookup, discover, searchCatalog };
}

module.exports = { createMusicMetadata };
