"use strict";

const { randomBytes } = require('node:crypto');
const { createMusicMetadata } = require('./music-metadata');
const { createMangaDex } = require('./mangadex');
const { createKomga } = require('./komga');
const { createJikan } = require('./jikan');
const { openDatabase, verifyPassword, publicUser } = require('./database');
const COOKIE = 'nexus_session';
const SESSION_SECONDS = 8 * 60 * 60;

function fail(status, message) {
  const error = new Error(message);
  error.status = status;
  throw error;
}
function json(response, status, body) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(body));
}
async function readJson(request) {
  if (request.headers['content-type']?.split(';')[0].trim() !== 'application/json') fail(415, 'Envie os dados como JSON.');
  let size = 0;
  const chunks = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 640 * 1024) fail(413, 'Dados muito grandes.');
    chunks.push(chunk);
  }
  let body;
  try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { fail(400, 'JSON inválido.'); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) fail(400, 'Dados inválidos.');
  return body;
}
function textField(body, key, max, allowEmpty = false) {
  if (typeof body[key] !== 'string') fail(400, `Campo ${key} inválido.`);
  const value = body[key].trim();
  if ((!allowEmpty && !value) || value.length > max) fail(400, `Campo ${key} inválido.`);
  return value;
}
function userFields(body, editing = false) {
  const username = textField(body, 'username', 80);
  const password = textField(body, 'password', 128, editing);
  if (!['Basic', 'Premium'].includes(body.plan)) fail(400, 'Plano inválido.');
  if (!['Ativo', 'Inativo'].includes(body.status)) fail(400, 'Status inválido.');
  return { username, password, plan: body.plan, status: body.status };
}

function createApi({ databasePath, databaseOptions, metadataOptions, mangadexOptions, jikanOptions } = {}) {
  const musicMetadata = createMusicMetadata(metadataOptions);
  const komga = createKomga();
  const mangadex = createMangaDex(mangadexOptions);
  const jikan = createJikan(jikanOptions);
  const db = openDatabase(databasePath, databaseOptions);
  const sessions = new Map();
  function tokenFrom(request) {
    return (request.headers.cookie || '').split(';').map(value => value.trim()).find(value => value.startsWith(COOKIE + '='))?.slice(COOKIE.length + 1);
  }
  function sessionUser(request) {
    const token = tokenFrom(request);
    const session = sessions.get(token);
    if (!session) return null;
    const user = db.getById(session.userId);
    if (session.expires <= Date.now() || !user || user.status !== 'Ativo') {
      sessions.delete(token);
      return null;
    }
    return user;
  }
  function revokeUser(id) {
    for (const [token, session] of sessions) if (session.userId === id) sessions.delete(token);
  }
  function cookie(response, token, maxAge) {
    response.setHeader('Set-Cookie', `${COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}`);
  }
  function requireMethod(request, response, methods) {
    if (!methods.includes(request.method)) {
      response.setHeader('Allow', methods.join(', '));
      fail(405, 'Método não permitido.');
    }
  }
  function requireUser(request) {
    const user = sessionUser(request);
    if (!user) fail(401, 'Entre novamente para continuar.');
    return user;
  }
  const decode = value => { try { return decodeURIComponent(value); } catch { fail(400, 'Identificador inválido.'); } };
  const integerField = (value, min, max, name) => {
    const number = Number(value);
    if (!Number.isInteger(number) || number < min || number > max) fail(400, `${name} inválido.`);
    return number;
  };
  function contentAllowed(user, rating) {
    if (['safe', 'suggestive'].includes(rating)) return true;
    return user.age_group === 'adult' && Boolean(user.explicit_enabled);
  }
  function mangaStateFields(body, current) {
    const readingStatus = body.readingStatus ?? current.reading_status;
    const viewMode = body.viewMode ?? current.view_mode;
    const reaction = body.reaction ?? current.reaction;
    const rating = body.rating === null ? null : (body.rating ?? current.rating);
    if (!['completed','reading','dropped','paused','planned'].includes(readingStatus)) fail(400, 'Status de leitura inválido.');
    if (!['chapter','volume'].includes(viewMode)) fail(400, 'Visualização inválida.');
    if (![ -1, 0, 1 ].includes(Number(reaction))) fail(400, 'Reação inválida.');
    if (rating !== null && ![1,2,3,4,5].includes(Number(rating))) fail(400, 'Avaliação inválida.');
    return {
      title: String(body.title ?? current.title ?? '').trim().slice(0,160), coverUrl: String(body.coverUrl ?? current.cover_url ?? '').slice(0,1000), sourceUrl: String(body.sourceUrl ?? current.source_url ?? '').slice(0,1000),
      favorite: body.favorite == null ? Boolean(current.favorite) : Boolean(body.favorite), readingStatus,
      chaptersRead: integerField(body.chaptersRead ?? current.chapters_read ?? 0,0,100000,'Quantidade de capítulos'), volumesRead: integerField(body.volumesRead ?? current.volumes_read ?? 0,0,100000,'Quantidade de volumes'),
      viewMode, rating: rating == null ? null : Number(rating), reaction: Number(reaction)
    };
  }
  async function handle(request, response, pathname) {
    try {
      if (!['GET', 'HEAD'].includes(request.method) && request.headers.origin) {
        let origin;
        try { origin = new URL(request.headers.origin); } catch { fail(403, 'Origem não permitida.'); }
        if (origin.host !== request.headers.host || !['http:', 'https:'].includes(origin.protocol)) fail(403, 'Origem não permitida.');
      }
      if (pathname === '/api/login') {
        requireMethod(request, response, ['POST']);
        const body = await readJson(request);
        const username = textField(body, 'username', 80);
        const password = textField(body, 'password', 128);
        const user = db.getByUsername(username);
        if (!user || !verifyPassword(password, user.password_hash)) fail(401, 'Credenciais inválidas.');
        if (user.status !== 'Ativo') fail(403, 'Conta Inativa. Contate o suporte.');
        for (const [token, session] of sessions) if (session.expires <= Date.now()) sessions.delete(token);
        sessions.delete(tokenFrom(request));
        const token = randomBytes(32).toString('hex');
        sessions.set(token, { userId: user.id, expires: Date.now() + SESSION_SECONDS * 1000 });
        cookie(response, token, SESSION_SECONDS);
        json(response, 200, { user: publicUser(user) });
        return;
      }
      if (pathname === '/api/session') {
        requireMethod(request, response, ['GET']);
        json(response, 200, { user: publicUser(sessionUser(request)) });
        return;
      }
      if (pathname === '/api/logout') {
        requireMethod(request, response, ['POST']);
        sessions.delete(tokenFrom(request));
        cookie(response, '', 0);
        json(response, 200, { message: 'Sessão encerrada.' });
        return;
      }
      if (pathname.startsWith('/api/mangadex/')) {
        requireMethod(request, response, ['GET']);
        const mangaUser = requireUser(request);
        const params = new URL(request.url, 'http://localhost').searchParams;
        if (pathname === '/api/mangadex/series') {
          const ratings = mangaUser.age_group === 'adult' && mangaUser.explicit_enabled ? ['safe','suggestive','erotica','pornographic'] : ['safe','suggestive'];
          const result = await mangadex.listSeries({ search: params.get('q'), page: params.get('page'), size: params.get('size'), lang: params.get('lang'), ratings });
          result.content = result.content.filter(item => contentAllowed(mangaUser,item.contentRating));
          for (const item of result.content) db.upsertCatalog('mangadex',item);
          json(response, 200, result);
          return;
        }
        const series = pathname.match(/^\/api\/mangadex\/series\/([^/]+)$/);
        const books = pathname.match(/^\/api\/mangadex\/series\/([^/]+)\/books$/);
        const pages = pathname.match(/^\/api\/mangadex\/books\/([^/]+)\/pages$/);
        const cover = pathname.match(/^\/api\/mangadex\/series\/([^/]+)\/thumbnail$/);
        const page = pathname.match(/^\/api\/mangadex\/books\/([^/]+)\/pages\/(\d+)$/);
        if (series) { const item=await mangadex.getSeries(series[1]);if(!contentAllowed(mangaUser,item.contentRating))fail(403,'Este conteúdo está bloqueado pelas configurações da conta.');db.upsertCatalog('mangadex',item);json(response, 200, { series:item }); return; }
        if (books) { const result=await mangadex.listBooks(books[1], { lang: params.get('lang'), offset: params.get('offset') });db.saveChapters('mangadex',books[1],result.books);json(response, 200, result); return; }
        if (pages) { const chapter=db.chapterItem('mangadex',pages[1]);if(!chapter||!contentAllowed(mangaUser,chapter.content_rating||'unknown'))fail(403,'Este capítulo está bloqueado pelas configurações da conta.');json(response, 200, { pages: await mangadex.listPages(pages[1]) }); return; }
        if (cover || page) {
          const protectedItem=cover?db.catalogItem('mangadex',cover[1]):db.chapterItem('mangadex',page[1]);
          if(!protectedItem||!contentAllowed(mangaUser,protectedItem.content_rating||'unknown'))fail(403,'Esta imagem está bloqueada pelas configurações da conta.');
          const image = cover ? await mangadex.cover(cover[1]) : await mangadex.pageImage(page[1], page[2]);
          response.writeHead(200, { 'Content-Type': image.type, 'Content-Length': image.buffer.length, 'Cache-Control': 'private, max-age=300' });
          response.end(image.buffer);
          return;
        }
        fail(404, 'Rota não encontrada.');
      }
      if (pathname === '/api/komga/status') {
        requireMethod(request, response, ['GET']);
        if (!sessionUser(request)) fail(401, 'Entre novamente para continuar.');
        json(response, 200, await komga.status());
        return;
      }
      if (pathname === '/api/komga/series') {
        requireMethod(request, response, ['GET']);
        const mangaUser = requireUser(request);
        const params = new URL(request.url, 'http://localhost').searchParams;
        const result=await komga.listSeries({ search: params.get('q'), page: params.get('page'), size: params.get('size') });
        result.content=result.content.filter(item=>contentAllowed(mangaUser,item.contentRating));for(const item of result.content)db.upsertCatalog('komga',item);json(response,200,result);
        return;
      }
      if (pathname === '/api/account/profile') {
        const user = requireUser(request); requireMethod(request,response,['GET','PUT']);
        if (request.method === 'GET') { json(response,200,{user:publicUser(user),stats:db.stats(user.id)}); return; }
        const body=await readJson(request); const displayName=textField(body,'displayName',80); const bio=textField(body,'bio',500,true);
        const interests=Array.isArray(body.interests)?body.interests.map(v=>String(v).trim()).filter(Boolean).slice(0,12).map(v=>v.slice(0,40)):fail(400,'Interesses inválidos.');
        const avatar=typeof body.avatar==='string'?body.avatar:'';
        if (avatar && (!/^data:image\/(png|jpeg|webp);base64,/i.test(avatar) || avatar.length>550000)) fail(400,'A foto deve ser PNG, JPG ou WebP e ter até 400 KB.');
        json(response,200,{user:db.updateProfile(user.id,{displayName,bio,interests,avatar,profilePublic:Boolean(body.profilePublic),interestsPublic:Boolean(body.interestsPublic)}),stats:db.stats(user.id)}); return;
      }
      if (pathname === '/api/account/preferences') {
        const user=requireUser(request); requireMethod(request,response,['PUT']); const body=await readJson(request);
        if(!['grid','list'].includes(body.catalogView)||!['paged','continuous'].includes(body.readerMode)) fail(400,'Preferências inválidas.');
        json(response,200,{user:db.updatePreferences(user.id,body)}); return;
      }
      if (pathname === '/api/account/age') {
        const user=requireUser(request); requireMethod(request,response,['POST']); if(user.age_group!=='unknown') fail(409,'A faixa etária já foi confirmada.');
        const body=await readJson(request); if(typeof body.adult!=='boolean') fail(400,'Confirmação inválida.');
        json(response,200,{user:db.setAgeGroup(user.id,body.adult?'adult':'minor')}); return;
      }
      if (pathname === '/api/account/content-pin') {
        const user=requireUser(request); requireMethod(request,response,['POST']); if(user.age_group!=='adult') fail(403,'Conteúdo adulto não está disponível para esta conta.');
        if(user.explicit_pin_hash) fail(409,'O PIN já existe. Use o PIN atual para desbloquear ou redefina com sua senha.');
        const pin=textField(await readJson(request),'pin',4); if(!/^\d{4}$/.test(pin)) fail(400,'Use um PIN de quatro números.');
        json(response,200,{user:db.setContentPin(user.id,pin)}); return;
      }
      if (pathname === '/api/account/content-unlock') {
        const user=requireUser(request); requireMethod(request,response,['POST']); const pin=textField(await readJson(request),'pin',4); const result=db.verifyContentPin(user,pin);
        if(!result.ok) fail(429,result.lockedUntil?'Muitas tentativas. Aguarde 15 minutos.':`PIN incorreto. Restam ${result.remaining} tentativas.`);
        json(response,200,{user:publicUser(db.getById(user.id))}); return;
      }
      if (pathname === '/api/account/content-reset') {
        const user=requireUser(request); requireMethod(request,response,['POST']); const password=textField(await readJson(request),'password',128);
        if(!verifyPassword(password,user.password_hash)) fail(401,'Senha incorreta.'); json(response,200,{user:db.resetContent(user.id)}); return;
      }
      if (pathname === '/api/account/content-lock') { const user=requireUser(request);requireMethod(request,response,['POST']);json(response,200,{user:db.lockContent(user.id)});return; }
      const mangaState=pathname.match(/^\/api\/manga\/state\/([^/]+)\/([^/]+)$/);
      if (mangaState) {
        const user=requireUser(request); requireMethod(request,response,['GET','PUT']); const p=decode(mangaState[1]),sid=decode(mangaState[2]); const current=db.getMangaState(user.id,p,sid);
        if(request.method==='PUT') db.saveMangaState(user.id,p,sid,mangaStateFields(await readJson(request),current));
        json(response,200,{state:db.getMangaState(user.id,p,sid),summary:db.mangaSummary(p,sid)}); return;
      }
      if (pathname === '/api/manga/favorites') { const user=requireUser(request); requireMethod(request,response,['GET']); json(response,200,{items:db.listFavorites(user.id)}); return; }
      if (pathname === '/api/manga/playlists') {
        const user=requireUser(request); requireMethod(request,response,['GET','POST']);
        if(request.method==='GET'){json(response,200,{playlists:db.listPlaylists(user.id)});return;}
        const name=textField(await readJson(request),'name',60); try{json(response,201,{playlist:db.createPlaylist(user.id,name)});}catch(error){if(error.code?.includes('CONSTRAINT'))fail(409,'Já existe uma lista com este nome.');throw error;} return;
      }
      const playlist=pathname.match(/^\/api\/manga\/playlists\/(\d+)$/);
      const playlistItems=pathname.match(/^\/api\/manga\/playlists\/(\d+)\/items$/);
      const playlistItem=pathname.match(/^\/api\/manga\/playlists\/(\d+)\/items\/([^/]+)\/([^/]+)$/);
      if(playlist||playlistItems||playlistItem){
        const user=requireUser(request); const id=Number((playlist||playlistItems||playlistItem)[1]);
        if(playlist){requireMethod(request,response,['GET','PUT','DELETE']);if(request.method==='GET'){const items=db.listPlaylistItems(user.id,id);if(!items)fail(404,'Lista não encontrada.');json(response,200,{items});return;}if(request.method==='DELETE'){if(!db.deletePlaylist(user.id,id).changes)fail(404,'Lista não encontrada.');json(response,200,{message:'Lista removida.'});return;}const name=textField(await readJson(request),'name',60);const value=db.renamePlaylist(user.id,id,name);if(!value)fail(404,'Lista não encontrada.');json(response,200,{playlist:value});return;}
        if(playlistItems){requireMethod(request,response,['POST']);const body=await readJson(request);const item={provider:textField(body,'provider',30),seriesId:textField(body,'seriesId',160),title:textField(body,'title',160),coverUrl:typeof body.coverUrl==='string'?body.coverUrl.slice(0,1000):'',sourceUrl:typeof body.sourceUrl==='string'?body.sourceUrl.slice(0,1000):''};if(!db.addPlaylistItem(user.id,id,item))fail(404,'Lista não encontrada.');json(response,201,{item});return;}
        requireMethod(request,response,['DELETE']);if(!db.removePlaylistItem(user.id,id,decode(playlistItem[2]),decode(playlistItem[3])))fail(404,'Lista não encontrada.');json(response,200,{message:'Item removido.'});return;
      }
      const progress=pathname.match(/^\/api\/manga\/progress\/([^/]+)\/([^/]+)\/([^/]+)$/);
      if(progress){const user=requireUser(request);requireMethod(request,response,['GET','PUT']);const [p,sid,bid]=progress.slice(1).map(decode);if(request.method==='GET'){json(response,200,{progress:db.getProgress(user.id,p,sid,bid)});return;}const body=await readJson(request);const page=integerField(body.page,1,100000,'Página');if(!['paged','continuous'].includes(body.mode))fail(400,'Modo de leitura inválido.');json(response,200,{progress:db.saveProgress(user.id,p,sid,bid,page,body.mode)});return;}
      const comments=pathname.match(/^\/api\/manga\/comments\/([^/]+)\/([^/]+)\/([^/]+)$/);
      const comment=pathname.match(/^\/api\/manga\/comments\/(\d+)$/);
      const report=pathname.match(/^\/api\/manga\/comments\/(\d+)\/report$/);
      if(comments){const user=requireUser(request);requireMethod(request,response,['GET','POST']);const [p,sid,bid]=comments.slice(1).map(decode);if(request.method==='GET'){json(response,200,{comments:db.listComments(p,sid,bid,user.id)});return;}if(db.recentCommentCount(user.id)>=5)fail(429,'Aguarde antes de publicar outro comentário.');const content=textField(await readJson(request),'content',1000);db.addComment(user.id,p,sid,bid,content);json(response,201,{comments:db.listComments(p,sid,bid,user.id)});return;}
      if(comment||report){const user=requireUser(request);const id=Number((comment||report)[1]);if(report){requireMethod(request,response,['POST']);const reason=textField(await readJson(request),'reason',200);if(!db.reportComment(user.id,id,reason))fail(404,'Comentário não encontrado.');json(response,200,{message:'Denúncia registrada.'});return;}requireMethod(request,response,['PUT','DELETE']);if(request.method==='DELETE'){if(!db.deleteComment(user.id,id).changes)fail(403,'Você só pode remover seu comentário.');json(response,200,{message:'Comentário removido.'});return;}const content=textField(await readJson(request),'content',1000);if(!db.editComment(user.id,id,content).changes)fail(403,'Você só pode editar seu comentário.');json(response,200,{message:'Comentário atualizado.'});return;}
      if(pathname==='/api/suggestions'){const user=requireUser(request);requireMethod(request,response,['POST']);if(db.recentSuggestions(user.id)>=3)fail(429,'Limite de sugestões atingido. Tente mais tarde.');const body=await readJson(request);json(response,201,{suggestion:db.addSuggestion(user.id,textField(body,'subject',120),textField(body,'description',2000))});return;}
      if(pathname==='/api/admin/suggestions'){const user=requireUser(request);requireMethod(request,response,['GET']);if(user.role!=='admin')fail(403,'Acesso restrito ao administrador.');json(response,200,{suggestions:db.listSuggestions()});return;}
      const publicProfileRoute=pathname.match(/^\/api\/profiles\/([^/]+)$/);
      if(publicProfileRoute){requireMethod(request,response,['GET']);const profile=db.publicProfile(decode(publicProfileRoute[1]));if(!profile)fail(404,'Perfil não encontrado ou privado.');json(response,200,{profile});return;}
      if (pathname === '/api/jikan/manga') {
        requireMethod(request, response, ['GET']);
        if (!sessionUser(request)) fail(401, 'Entre novamente para continuar.');
        const title = new URL(request.url, 'http://localhost').searchParams.get('q');
        json(response, 200, { manga: await jikan.lookup(title) });
        return;
      }
      const komgaSeries = pathname.match(/^\/api\/komga\/series\/([^/]+)$/);
      if (komgaSeries) {
        requireMethod(request, response, ['GET']);
        const mangaUser=requireUser(request);const item=await komga.getSeries(decodeURIComponent(komgaSeries[1]));if(!contentAllowed(mangaUser,item.contentRating))fail(403,'Este conteúdo está bloqueado pelas configurações da conta.');db.upsertCatalog('komga',item);json(response, 200, { series:item });
        return;
      }
      const komgaSeriesBooks = pathname.match(/^\/api\/komga\/series\/([^/]+)\/books$/);
      if (komgaSeriesBooks) {
        requireMethod(request, response, ['GET']);
        if (!sessionUser(request)) fail(401, 'Entre novamente para continuar.');
        const sid=decodeURIComponent(komgaSeriesBooks[1]);const books=await komga.listBooks(sid);db.saveChapters('komga',sid,books);json(response, 200, { books });
        return;
      }
      const komgaPages = pathname.match(/^\/api\/komga\/books\/([^/]+)\/pages$/);
      if (komgaPages) {
        requireMethod(request, response, ['GET']);
        if (!sessionUser(request)) fail(401, 'Entre novamente para continuar.');
        const bid=decodeURIComponent(komgaPages[1]);const user=requireUser(request),chapter=db.chapterItem('komga',bid);if(!chapter||!contentAllowed(user,chapter.content_rating||'unknown'))fail(403,'Este capítulo está bloqueado pelas configurações da conta.');json(response, 200, { pages: await komga.listPages(bid) });
        return;
      }
      const komgaSeriesImage = pathname.match(/^\/api\/komga\/series\/([^/]+)\/thumbnail$/);
      const komgaBookImage = pathname.match(/^\/api\/komga\/books\/([^/]+)\/thumbnail$/);
      const komgaPageImage = pathname.match(/^\/api\/komga\/books\/([^/]+)\/pages\/(\d+)$/);
      if (komgaSeriesImage || komgaBookImage || komgaPageImage) {
        requireMethod(request, response, ['GET']);
        const imageUser=requireUser(request);const protectedItem=komgaSeriesImage?db.catalogItem('komga',decodeURIComponent(komgaSeriesImage[1])):db.chapterItem('komga',decodeURIComponent((komgaBookImage||komgaPageImage)[1]));if(!protectedItem||!contentAllowed(imageUser,protectedItem.content_rating||'unknown'))fail(403,'Esta imagem está bloqueada pelas configurações da conta.');
        const target = komgaSeriesImage
          ? `/api/v1/series/${encodeURIComponent(decodeURIComponent(komgaSeriesImage[1]))}/thumbnail`
          : komgaBookImage
            ? `/api/v1/books/${encodeURIComponent(decodeURIComponent(komgaBookImage[1]))}/thumbnail`
            : `/api/v1/books/${encodeURIComponent(decodeURIComponent(komgaPageImage[1]))}/pages/${Number(komgaPageImage[2])}`;
        const image = await komga.image(target);
        response.writeHead(200, {
          'Content-Type': image.type,
          'Content-Length': image.buffer.length,
          'Cache-Control': 'private, max-age=300',
          ...(image.etag ? { ETag: image.etag } : {})
        });
        response.end(image.buffer);
        return;
      }
      if (pathname === '/api/music/metadata') {
        requireMethod(request, response, ['GET']);
        if (!sessionUser(request)) fail(401, 'Entre novamente para continuar.');
        const params = new URL(request.url, 'http://localhost').searchParams;
        const result = await musicMetadata.lookup({ artist: params.get('artist'), track: params.get('track') });
        json(response, 200, result);
        return;
      }
      if (pathname === '/api/music/discover') {
        requireMethod(request, response, ['GET']);
        if (!sessionUser(request)) fail(401, 'Entre novamente para continuar.');
        const params = new URL(request.url, 'http://localhost').searchParams;
        json(response, 200, await musicMetadata.discover(params.get('limit')));
        return;
      }
      if (pathname === '/api/music/search') {
        requireMethod(request, response, ['GET']);
        if (!sessionUser(request)) fail(401, 'Entre novamente para continuar.');
        const params = new URL(request.url, 'http://localhost').searchParams;
        json(response, 200, await musicMetadata.searchCatalog(params.get('q'), params.get('limit')));
        return;
      }
      if (pathname !== '/api/users' && !pathname.startsWith('/api/users/')) fail(404, 'Rota não encontrada.');
      const currentUser = sessionUser(request);
      if (!currentUser) fail(401, 'Entre novamente para continuar.');
      if (currentUser.role !== 'admin') fail(403, 'Acesso restrito ao administrador.');
      if (pathname === '/api/users') {
        requireMethod(request, response, ['GET', 'POST']);
        if (request.method === 'GET') { json(response, 200, { users: db.listUsers() }); return; }
        const data = userFields(await readJson(request));
        if (db.getByUsername(data.username)) fail(409, 'Usuário já existe!');
        json(response, 201, { user: db.addUser(data), message: 'Usuário criado com sucesso!' });
        return;
      }
      requireMethod(request, response, ['PUT', 'DELETE']);
      let username;
      try { username = decodeURIComponent(pathname.slice('/api/users/'.length)); }
      catch { fail(400, 'Usuário inválido.'); }
      const user = db.getByUsername(username);
      if (!user) fail(404, 'Usuário não encontrado.');
      if (user.role === 'admin') fail(403, 'O administrador principal não pode ser alterado por esta tela.');
      if (request.method === 'DELETE') {
        db.deleteUser(user.id);
        revokeUser(user.id);
        json(response, 200, { message: 'Usuário removido.' });
        return;
      }
      const data = userFields(await readJson(request), true);
      const conflict = db.getByUsername(data.username);
      if (conflict && conflict.id !== user.id) fail(409, 'Novo nome de usuário já está em uso.');
      const updated = db.updateUser(user, data);
      if (data.password || data.status !== 'Ativo') revokeUser(user.id);
      json(response, 200, { user: updated, message: 'Usuário atualizado com sucesso!' });
    } catch (error) {
      if (!error.status) console.error('Erro na API:', error.message);
      if (!response.headersSent && !response.destroyed) json(response, error.status || 500, {
        message: error.status ? error.message : 'Erro ao acessar o banco de dados.',
        ...(error.code ? { code: error.code } : {})
      });
    }
  }
  return { handle, close() { sessions.clear(); db.close(); } };
}

module.exports = { createApi };
