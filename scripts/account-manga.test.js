'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createServer } = require('../server');

async function session(base, username, password) {
  const response = await fetch(base + '/api/login', { method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({username,password}) });
  assert.equal(response.status,200);
  return response.headers.get('set-cookie').split(';')[0];
}

test('persists manga library, progress, profile, comments and suggestions per account', async t => {
  const server=createServer({databasePath:':memory:',databaseOptions:{env:{NEXUS_ADMIN_PASSWORD:'admin',NEXUS_SEED_DEMO:'1'},logger:{warn(){}}}});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections()}));
  const base=`http://127.0.0.1:${server.address().port}`, cookie=await session(base,'user','123');
  const call=(path,method='GET',body,c=cookie)=>fetch(base+path,{method,headers:{cookie:c,...(body?{'content-type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});

  const avatar='data:image/png;base64,iVBORw0KGgo=';
  let response=await call('/api/account/profile','PUT',{displayName:'Leitor',bio:'Mangás',interests:['Ação'],avatar,profilePublic:true,interestsPublic:true});
  const savedProfile=await response.json();assert.equal(savedProfile.user.displayName,'Leitor');assert.ok(savedProfile.user.createdAt);
  assert.equal((await (await call('/api/account/profile')).json()).user.bio,'Mangás');
  const relogged=await session(base,'user','123');
  const persisted=(await (await call('/api/account/profile','GET',undefined,relogged)).json()).user;
  assert.equal(persisted.displayName,'Leitor');assert.equal(persisted.bio,'Mangás');assert.equal(persisted.avatar,avatar);
  response=await fetch(base+'/perfil',{headers:{cookie:relogged}});assert.equal(response.status,200);assert.match(await response.text(),/profile-view/);
  response=await call('/api/account/age','POST',{adult:true}); assert.equal(response.status,200);
  response=await call('/api/account/content-pin','POST',{pin:'1234'}); assert.equal((await response.json()).user.explicitEnabled,true);

  const state={title:'Obra',coverUrl:'/cover',sourceUrl:'',favorite:true,readingStatus:'reading',chaptersRead:3,volumesRead:1,viewMode:'chapter',rating:5,reaction:1};
  response=await call('/api/manga/state/mangadex/series-1','PUT',state); assert.equal((await response.json()).state.favorite,true);
  response=await call('/api/manga/favorites'); assert.equal((await response.json()).items[0].title,'Obra');
  response=await call('/api/manga/playlists','POST',{name:'Lendo agora'}); const playlist=(await response.json()).playlist;
  assert.equal((await call(`/api/manga/playlists/${playlist.id}/items`,'POST',{provider:'mangadex',seriesId:'series-1',title:'Obra',coverUrl:'',sourceUrl:''})).status,201);
  assert.equal((await (await call(`/api/manga/playlists/${playlist.id}`)).json()).items.length,1);
  response=await call('/api/manga/progress/mangadex/series-1/book-1','PUT',{page:7,mode:'continuous'}); assert.equal((await response.json()).progress.page,7);

  response=await call('/api/manga/comments/mangadex/series-1/book-1','POST',{content:'Ótimo capítulo'}); assert.equal(response.status,201);
  const comments=(await (await call('/api/manga/comments/mangadex/series-1/book-1')).json()).comments; assert.equal(comments[0].own,true);
  assert.equal((await call('/api/suggestions','POST',{subject:'Leitor',description:'Adicionar contraste maior.'})).status,201);
  const admin=await session(base,'admin','admin');
  response=await call('/api/admin/suggestions','GET',undefined,admin); assert.equal((await response.json()).suggestions.length,1);
  assert.equal((await call(`/api/manga/comments/${comments[0].id}`,'DELETE',undefined,admin)).status,403);
});

test('content PIN rate limit locks repeated invalid attempts', async t => {
  const server=createServer({databasePath:':memory:',databaseOptions:{env:{NEXUS_ADMIN_PASSWORD:'admin',NEXUS_SEED_DEMO:'1'},logger:{warn(){}}}});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections()}));
  const base=`http://127.0.0.1:${server.address().port}`,cookie=await session(base,'user','123');
  const post=(path,body)=>fetch(base+path,{method:'POST',headers:{cookie,'content-type':'application/json'},body:JSON.stringify(body)});
  await post('/api/account/age',{adult:true});await post('/api/account/content-pin',{pin:'1234'});
  let response;for(let i=0;i<5;i++)response=await post('/api/account/content-unlock',{pin:'9999'});
  assert.equal(response.status,429);assert.match((await response.json()).message,/15 minutos/);
});
