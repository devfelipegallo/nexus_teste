"use strict";

const { DatabaseSync } = require('node:sqlite');
const { randomBytes, scryptSync, timingSafeEqual } = require('node:crypto');
const { mkdirSync } = require('node:fs');
const path = require('node:path');

function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  return `${salt}:${scryptSync(password, salt, 64).toString('hex')}`;
}

function verifyPassword(password, stored = '') {
  const [salt, hash] = stored.split(':');
  if (!salt || !hash) return false;
  const expected = Buffer.from(hash, 'hex');
  const actual = scryptSync(password, salt, 64);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function parseInterests(value) {
  try { const data = JSON.parse(value || '[]'); return Array.isArray(data) ? data : []; } catch { return []; }
}

function publicUser(user) {
  if (!user) return null;
  return {
    id: user.id, username: user.username, role: user.role, plan: user.plan, status: user.status,
    displayName: user.display_name || user.username, bio: user.bio || '', interests: parseInterests(user.interests),
    avatar: user.avatar_data || '', profilePublic: Boolean(user.profile_public), interestsPublic: Boolean(user.interests_public),
    ageGroup: user.age_group || 'unknown', explicitEnabled: Boolean(user.explicit_enabled), contentPinSet: Boolean(user.explicit_pin_hash),
    catalogView: user.catalog_view || 'grid', readerMode: user.reader_mode || 'paged', createdAt: user.created_at || null
  };
}

function openDatabase(filename = path.join(__dirname, '..', '..', 'data', 'nexus.sqlite'), { env = process.env, logger = console } = {}) {
  if (filename !== ':memory:') mkdirSync(path.dirname(filename), { recursive: true });
  const connection = new DatabaseSync(filename, { timeout: 5000 });
  connection.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL;');
  try {
    connection.exec('BEGIN IMMEDIATE');
    let version = connection.prepare('PRAGMA user_version').get().user_version;
    const existingDatabase = version > 0;
    if (version === 0) {
      connection.exec(`CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'user' CHECK(role IN ('user','admin')), plan TEXT NOT NULL CHECK(plan IN ('Basic','Premium','Infinite')), status TEXT NOT NULL CHECK(status IN ('Ativo','Inativo')))`);
      const insert = connection.prepare('INSERT INTO users(username,password_hash,role,plan,status) VALUES(?,?,?,?,?)');
      const configuredPassword = String(env.NEXUS_ADMIN_PASSWORD || '');
      const adminPassword = configuredPassword || randomBytes(24).toString('base64url');
      insert.run('admin',hashPassword(adminPassword),'admin','Infinite','Ativo');
      if (!configuredPassword) logger.warn(`NEXUS: senha inicial do administrador: ${adminPassword}\nGuarde-a agora; ela não será exibida novamente.`);
      if (String(env.NEXUS_SEED_DEMO || '') === '1') {
        insert.run('user',hashPassword('123'),'user','Premium','Ativo');
        insert.run('visitante',hashPassword('abc'),'user','Basic','Inativo');
      }
      connection.exec('PRAGMA user_version=1'); version = 1;
    }
    if (version === 1) {
      for (const sql of [
        "ALTER TABLE users ADD COLUMN display_name TEXT", "ALTER TABLE users ADD COLUMN bio TEXT NOT NULL DEFAULT ''", "ALTER TABLE users ADD COLUMN interests TEXT NOT NULL DEFAULT '[]'", "ALTER TABLE users ADD COLUMN avatar_data TEXT NOT NULL DEFAULT ''",
        "ALTER TABLE users ADD COLUMN profile_public INTEGER NOT NULL DEFAULT 0", "ALTER TABLE users ADD COLUMN interests_public INTEGER NOT NULL DEFAULT 0", "ALTER TABLE users ADD COLUMN age_group TEXT NOT NULL DEFAULT 'unknown'", "ALTER TABLE users ADD COLUMN explicit_enabled INTEGER NOT NULL DEFAULT 0",
        "ALTER TABLE users ADD COLUMN explicit_pin_hash TEXT", "ALTER TABLE users ADD COLUMN pin_failures INTEGER NOT NULL DEFAULT 0", "ALTER TABLE users ADD COLUMN pin_locked_until INTEGER", "ALTER TABLE users ADD COLUMN catalog_view TEXT NOT NULL DEFAULT 'grid'", "ALTER TABLE users ADD COLUMN reader_mode TEXT NOT NULL DEFAULT 'paged'", "ALTER TABLE users ADD COLUMN created_at TEXT"
      ]) connection.exec(sql);
      connection.exec("UPDATE users SET display_name=username,created_at=COALESCE(created_at,datetime('now'))");
      connection.exec(`
        CREATE TABLE manga_state (user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, provider TEXT NOT NULL, series_id TEXT NOT NULL, title TEXT NOT NULL DEFAULT '', cover_url TEXT NOT NULL DEFAULT '', source_url TEXT NOT NULL DEFAULT '', favorite INTEGER NOT NULL DEFAULT 0, reading_status TEXT NOT NULL DEFAULT 'planned', chapters_read INTEGER NOT NULL DEFAULT 0, volumes_read INTEGER NOT NULL DEFAULT 0, view_mode TEXT NOT NULL DEFAULT 'chapter', rating INTEGER CHECK(rating BETWEEN 1 AND 5), reaction INTEGER NOT NULL DEFAULT 0 CHECK(reaction BETWEEN -1 AND 1), updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY(user_id,provider,series_id));
        CREATE TABLE manga_playlists (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, name TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE(user_id,name));
        CREATE TABLE manga_playlist_items (playlist_id INTEGER NOT NULL REFERENCES manga_playlists(id) ON DELETE CASCADE, provider TEXT NOT NULL, series_id TEXT NOT NULL, title TEXT NOT NULL, cover_url TEXT NOT NULL DEFAULT '', source_url TEXT NOT NULL DEFAULT '', added_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY(playlist_id,provider,series_id));
        CREATE TABLE reader_progress (user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, provider TEXT NOT NULL, series_id TEXT NOT NULL, book_id TEXT NOT NULL, page INTEGER NOT NULL DEFAULT 1, mode TEXT NOT NULL DEFAULT 'paged', updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY(user_id,provider,series_id,book_id));
        CREATE TABLE manga_catalog (provider TEXT NOT NULL, series_id TEXT NOT NULL, title TEXT NOT NULL, cover_url TEXT NOT NULL DEFAULT '', content_rating TEXT NOT NULL DEFAULT 'unknown', added_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY(provider,series_id));
        CREATE TABLE manga_chapters (provider TEXT NOT NULL, book_id TEXT NOT NULL, series_id TEXT NOT NULL, title TEXT NOT NULL, volume TEXT, chapter TEXT, sort_key REAL NOT NULL DEFAULT 0, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY(provider,book_id));
        CREATE TABLE comments (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, provider TEXT NOT NULL, series_id TEXT NOT NULL, book_id TEXT NOT NULL, content TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
        CREATE TABLE comment_reports (id INTEGER PRIMARY KEY AUTOINCREMENT, comment_id INTEGER NOT NULL REFERENCES comments(id) ON DELETE CASCADE, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, reason TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE(comment_id,user_id));
        CREATE TABLE suggestions (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, subject TEXT NOT NULL, description TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'Nova', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
        CREATE INDEX manga_state_favorites ON manga_state(user_id,favorite,updated_at);
        CREATE INDEX comments_book ON comments(provider,series_id,book_id,created_at);
      `);
      connection.exec('PRAGMA user_version=2');
    }
    connection.exec('COMMIT');
    if (existingDatabase) {
      const defaults = [['admin','admin'],['user','123'],['visitante','abc']];
      const lookup = connection.prepare('SELECT password_hash FROM users WHERE username=?');
      const insecure = defaults.filter(([username,password]) => {
        const row = lookup.get(username);
        return row && verifyPassword(password,row.password_hash);
      }).map(([username]) => username);
      if (insecure.length) logger.warn(`NEXUS: atenção — contas com senha padrão detectadas: ${insecure.join(', ')}. Altere essas senhas no painel administrativo.`);
    }
  } catch (error) { try { connection.exec('ROLLBACK'); } catch {} connection.close(); throw error; }

  const byUsername = connection.prepare('SELECT * FROM users WHERE username=?');
  const byId = connection.prepare('SELECT * FROM users WHERE id=?');
  const stateSelect = connection.prepare('SELECT * FROM manga_state WHERE user_id=? AND provider=? AND series_id=?');
  const playlistSelect = connection.prepare('SELECT * FROM manga_playlists WHERE id=? AND user_id=?');
  const commentSelect = connection.prepare('SELECT * FROM comments WHERE id=?');
  const mapState = row => row ? ({...row,favorite:Boolean(row.favorite)}) : null;
  return {
    getByUsername: username => byUsername.get(username), getById: id => byId.get(id),
    listUsers: () => connection.prepare("SELECT id,username,role,plan,status FROM users WHERE role!='admin' ORDER BY id").all(),
    addUser(data) { const r=connection.prepare("INSERT INTO users(username,password_hash,role,plan,status,display_name,created_at) VALUES(?,?,'user',?,?,?,datetime('now'))").run(data.username,hashPassword(data.password),data.plan,data.status,data.username); return publicUser(byId.get(Number(r.lastInsertRowid))); },
    updateUser(user,data) { connection.prepare("UPDATE users SET username=?,password_hash=?,plan=?,status=? WHERE id=? AND role='user'").run(data.username,data.password?hashPassword(data.password):user.password_hash,data.plan,data.status,user.id); return publicUser(byId.get(user.id)); },
    deleteUser: id => connection.prepare("DELETE FROM users WHERE id=? AND role='user'").run(id),
    updateProfile(id,d) { connection.prepare('UPDATE users SET display_name=?,bio=?,interests=?,avatar_data=?,profile_public=?,interests_public=? WHERE id=?').run(d.displayName,d.bio,JSON.stringify(d.interests),d.avatar,d.profilePublic?1:0,d.interestsPublic?1:0,id); return publicUser(byId.get(id)); },
    updatePreferences(id,d) { connection.prepare('UPDATE users SET catalog_view=?,reader_mode=? WHERE id=?').run(d.catalogView,d.readerMode,id); return publicUser(byId.get(id)); },
    setAgeGroup(id,group) { connection.prepare("UPDATE users SET age_group=?,explicit_enabled=0,explicit_pin_hash=NULL,pin_failures=0,pin_locked_until=NULL WHERE id=? AND age_group='unknown'").run(group,id); return publicUser(byId.get(id)); },
    setContentPin(id,pin) { connection.prepare("UPDATE users SET explicit_pin_hash=?,explicit_enabled=1,pin_failures=0,pin_locked_until=NULL WHERE id=? AND age_group='adult'").run(hashPassword(pin),id); return publicUser(byId.get(id)); },
    verifyContentPin(user,pin) { const now=Date.now(); if(Number(user.pin_locked_until)>now)return{ok:false,lockedUntil:Number(user.pin_locked_until)}; if(verifyPassword(pin,user.explicit_pin_hash||'')){connection.prepare('UPDATE users SET explicit_enabled=1,pin_failures=0,pin_locked_until=NULL WHERE id=?').run(user.id);return{ok:true}} const n=Number(user.pin_failures||0)+1,lock=n>=5?now+900000:null;connection.prepare('UPDATE users SET pin_failures=?,pin_locked_until=? WHERE id=?').run(lock?0:n,lock,user.id);return{ok:false,lockedUntil:lock,remaining:lock?0:5-n}; },
    resetContent(id) { connection.prepare('UPDATE users SET explicit_enabled=0,explicit_pin_hash=NULL,pin_failures=0,pin_locked_until=NULL WHERE id=?').run(id); return publicUser(byId.get(id)); },
    lockContent(id) { connection.prepare('UPDATE users SET explicit_enabled=0 WHERE id=?').run(id);return publicUser(byId.get(id)); },
    getMangaState(uid,p,sid) { return mapState(stateSelect.get(uid,p,sid))||{provider:p,series_id:sid,favorite:false,reading_status:'planned',chapters_read:0,volumes_read:0,view_mode:'chapter',rating:null,reaction:0}; },
    saveMangaState(uid,p,sid,d) { connection.prepare(`INSERT INTO manga_state(user_id,provider,series_id,title,cover_url,source_url,favorite,reading_status,chapters_read,volumes_read,view_mode,rating,reaction,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP) ON CONFLICT(user_id,provider,series_id) DO UPDATE SET title=excluded.title,cover_url=excluded.cover_url,source_url=excluded.source_url,favorite=excluded.favorite,reading_status=excluded.reading_status,chapters_read=excluded.chapters_read,volumes_read=excluded.volumes_read,view_mode=excluded.view_mode,rating=excluded.rating,reaction=excluded.reaction,updated_at=CURRENT_TIMESTAMP`).run(uid,p,sid,d.title,d.coverUrl,d.sourceUrl,d.favorite?1:0,d.readingStatus,d.chaptersRead,d.volumesRead,d.viewMode,d.rating,d.reaction); return this.getMangaState(uid,p,sid); },
    mangaSummary(p,sid) { return connection.prepare('SELECT ROUND(AVG(rating),1) average,COUNT(rating) ratingCount,SUM(reaction=1) likes,SUM(reaction=-1) dislikes FROM manga_state WHERE provider=? AND series_id=?').get(p,sid); },
    listFavorites: uid => connection.prepare('SELECT * FROM manga_state WHERE user_id=? AND favorite=1 ORDER BY updated_at DESC').all(uid).map(mapState),
    listPlaylists: uid => connection.prepare('SELECT p.*,COUNT(i.series_id) item_count FROM manga_playlists p LEFT JOIN manga_playlist_items i ON i.playlist_id=p.id WHERE p.user_id=? GROUP BY p.id ORDER BY p.created_at DESC').all(uid),
    createPlaylist(uid,name) { const r=connection.prepare('INSERT INTO manga_playlists(user_id,name) VALUES(?,?)').run(uid,name); return playlistSelect.get(Number(r.lastInsertRowid),uid); },
    renamePlaylist(uid,id,name) { connection.prepare('UPDATE manga_playlists SET name=? WHERE id=? AND user_id=?').run(name,id,uid); return playlistSelect.get(id,uid); },
    deletePlaylist: (uid,id) => connection.prepare('DELETE FROM manga_playlists WHERE id=? AND user_id=?').run(id,uid),
    addPlaylistItem(uid,id,item) { if(!playlistSelect.get(id,uid))return null;connection.prepare('INSERT OR REPLACE INTO manga_playlist_items(playlist_id,provider,series_id,title,cover_url,source_url,added_at) VALUES(?,?,?,?,?,?,CURRENT_TIMESTAMP)').run(id,item.provider,item.seriesId,item.title,item.coverUrl,item.sourceUrl);return item; },
    removePlaylistItem(uid,id,p,sid) { if(!playlistSelect.get(id,uid))return null;return connection.prepare('DELETE FROM manga_playlist_items WHERE playlist_id=? AND provider=? AND series_id=?').run(id,p,sid); },
    listPlaylistItems(uid,id) { if(!playlistSelect.get(id,uid))return null;return connection.prepare('SELECT * FROM manga_playlist_items WHERE playlist_id=? ORDER BY added_at DESC').all(id); },
    getProgress(uid,p,sid,bid) { return connection.prepare('SELECT * FROM reader_progress WHERE user_id=? AND provider=? AND series_id=? AND book_id=?').get(uid,p,sid,bid)||{page:1,mode:'paged'}; },
    saveProgress(uid,p,sid,bid,page,mode) { connection.prepare(`INSERT INTO reader_progress(user_id,provider,series_id,book_id,page,mode,updated_at) VALUES(?,?,?,?,?,?,CURRENT_TIMESTAMP) ON CONFLICT(user_id,provider,series_id,book_id) DO UPDATE SET page=excluded.page,mode=excluded.mode,updated_at=CURRENT_TIMESTAMP`).run(uid,p,sid,bid,page,mode);return this.getProgress(uid,p,sid,bid); },
    listComments(p,sid,bid,uid) { return connection.prepare(`SELECT c.id,c.content,c.created_at createdAt,c.updated_at updatedAt,u.display_name author,u.avatar_data avatar,c.user_id=? own,(SELECT COUNT(*) FROM comment_reports r WHERE r.comment_id=c.id) reports FROM comments c JOIN users u ON u.id=c.user_id WHERE c.provider=? AND c.series_id=? AND c.book_id=? ORDER BY c.created_at DESC`).all(uid,p,sid,bid).map(r=>({...r,own:Boolean(r.own)})); },
    addComment(uid,p,sid,bid,content) { const r=connection.prepare('INSERT INTO comments(user_id,provider,series_id,book_id,content) VALUES(?,?,?,?,?)').run(uid,p,sid,bid,content);return commentSelect.get(Number(r.lastInsertRowid)); },
    editComment: (uid,id,content) => connection.prepare('UPDATE comments SET content=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND user_id=?').run(content,id,uid),
    deleteComment: (uid,id) => connection.prepare('DELETE FROM comments WHERE id=? AND user_id=?').run(id,uid),
    reportComment(uid,id,reason) { if(!commentSelect.get(id))return null;return connection.prepare('INSERT OR IGNORE INTO comment_reports(comment_id,user_id,reason) VALUES(?,?,?)').run(id,uid,reason); },
    recentCommentCount: uid => connection.prepare("SELECT COUNT(*) count FROM comments WHERE user_id=? AND created_at>=datetime('now','-1 minute')").get(uid).count,
    addSuggestion(uid,subject,description) { const r=connection.prepare('INSERT INTO suggestions(user_id,subject,description) VALUES(?,?,?)').run(uid,subject,description);return{id:Number(r.lastInsertRowid),subject,description,status:'Nova'}; },
    listSuggestions: () => connection.prepare('SELECT s.*,u.username FROM suggestions s JOIN users u ON u.id=s.user_id ORDER BY s.created_at DESC').all(),
    recentSuggestions: uid => connection.prepare("SELECT COUNT(*) count FROM suggestions WHERE user_id=? AND created_at>=datetime('now','-1 hour')").get(uid).count,
    stats: uid => connection.prepare('SELECT (SELECT COUNT(*) FROM manga_state WHERE user_id=? AND favorite=1) favorites,(SELECT COUNT(*) FROM manga_playlists WHERE user_id=?) playlists,(SELECT COUNT(*) FROM reader_progress WHERE user_id=?) chaptersStarted').get(uid,uid,uid),
    publicProfile(username) { const u=byUsername.get(username);if(!u||!u.profile_public)return null;return{username:u.username,displayName:u.display_name||u.username,bio:u.bio||'',avatar:u.avatar_data||'',interests:u.interests_public?parseInterests(u.interests):[],stats:this.stats(u.id)}; },
    upsertCatalog(p,item) { connection.prepare(`INSERT INTO manga_catalog(provider,series_id,title,cover_url,content_rating,added_at,updated_at) VALUES(?,?,?,?,?,COALESCE(?,CURRENT_TIMESTAMP),CURRENT_TIMESTAMP) ON CONFLICT(provider,series_id) DO UPDATE SET title=excluded.title,cover_url=excluded.cover_url,content_rating=excluded.content_rating,updated_at=CURRENT_TIMESTAMP`).run(p,item.id,item.title,item.thumbnailUrl||'',item.contentRating||'unknown',item.addedAt||null); },
    catalogItem: (p,id) => connection.prepare('SELECT * FROM manga_catalog WHERE provider=? AND series_id=?').get(p,id),
    saveChapters(p,sid,books) { const insert=connection.prepare(`INSERT INTO manga_chapters(provider,book_id,series_id,title,volume,chapter,sort_key,updated_at) VALUES(?,?,?,?,?,?,?,CURRENT_TIMESTAMP) ON CONFLICT(provider,book_id) DO UPDATE SET series_id=excluded.series_id,title=excluded.title,volume=excluded.volume,chapter=excluded.chapter,sort_key=excluded.sort_key,updated_at=CURRENT_TIMESTAMP`);for(const book of books)insert.run(p,book.id,sid,book.title,book.volume??null,book.chapter??null,Number.parseFloat(book.chapter??book.number)||0); },
    chapterItem: (p,id) => connection.prepare('SELECT c.*,m.content_rating FROM manga_chapters c LEFT JOIN manga_catalog m ON m.provider=c.provider AND m.series_id=c.series_id WHERE c.provider=? AND c.book_id=?').get(p,id),
    close: () => connection.close()
  };
}

module.exports = { openDatabase, verifyPassword, publicUser, hashPassword };
