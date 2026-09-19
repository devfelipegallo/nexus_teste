"use strict";

// Dados persistidos no SQLite pelo servidor; nenhum usuário fica no navegador.
class ApiDB {
  async request(url, options = {}) {
    let response;
    try {
      response = await fetch(url, {
        credentials: 'same-origin',
        ...options,
        headers: { 'Content-Type': 'application/json', ...options.headers }
      });
    } catch { throw new Error('Não foi possível conectar ao servidor. Inicie o projeto com npm start.'); }
    if (!response.headers.get('content-type')?.includes('application/json'))
      throw new Error('Abra o projeto pelo servidor Node.js (npm start), em http://localhost:3000.');
    const result = await response.json();
    if (!response.ok) throw new Error(result.message || 'Não foi possível concluir a operação.');
    return result;
  }
  async getSession() { return (await this.request('/api/session')).user; }
  async authenticate(username, password) {
    try { return [true, (await this.request('/api/login', { method: 'POST', body: JSON.stringify({ username, password }) })).user]; }
    catch (error) { return [false, error.message]; }
  }
  async getAllUsers() {
    const { users } = await this.request('/api/users');
    return new Map(users.map(user => [user.username, user]));
  }
  async mutate(url, method, data) {
    try {
      const result = await this.request(url, { method, ...(data ? { body: JSON.stringify(data) } : {}) });
      return [true, result.message];
    } catch (error) { return [false, error.message]; }
  }
  addUser(username, password, plan, status) {
    return this.mutate('/api/users', 'POST', { username, password, plan, status });
  }
  updateUser(oldUsername, username, password, plan, status) {
    return this.mutate('/api/users/' + encodeURIComponent(oldUsername), 'PUT', { username, password, plan, status });
  }
  deleteUser(username) { return this.mutate('/api/users/' + encodeURIComponent(username), 'DELETE'); }
  logout() { return this.request('/api/logout', { method: 'POST' }); }
}

// Player conectado ao elemento <audio>; os eventos atualizam os controles.
function createAudioPlayer({ audio, playButton, previousButton, nextButton, shuffleButton, repeatButton, muteButton, progress, currentTime, totalTime, volume, trackButtons, title, artist, durationLabels, notify, onTrackChange = () => {} }) {
  const buttons = [...trackButtons];
  let selected = null;
  let wantsPlay = false;
  let attempt = 0;
  let reportedError = false;
  let shuffle = false;
  let repeatMode = 'off';

  function setIcon(button, name) {
    let icon = button.querySelector?.('i');
    if (!icon && button.ownerDocument) {
      icon = button.ownerDocument.createElement('i');
      button.replaceChildren(icon);
    }
    if (icon) icon.className = `ph ph-${name}`;
  }

  function updateButtons() {
    const active = !audio.paused && !audio.ended;
    setIcon(playButton, active ? 'pause' : 'play');
    playButton.setAttribute('aria-label', active ? 'Pausar' : 'Reproduzir');
    buttons.forEach(button => {
      const playingThis = button === selected && active;
      const icon = button.querySelector('[data-play-icon]');
      if (icon) icon.className = playingThis ? 'ph ph-pause' : 'ph ph-play';
      else setIcon(button, playingThis ? 'pause' : 'play');
      button.setAttribute('aria-label', `${playingThis ? 'Pausar' : 'Reproduzir'} ${button.dataset.title || 'faixa ' + button.dataset.track}`);
    });
  }
  function updateProgress() {
    const canSeek = Boolean(selected) && Number.isFinite(audio.duration) && audio.duration > 0;
    progress.disabled = !canSeek;
    progress.value = canSeek ? Math.min(1, audio.currentTime / audio.duration) : 0;
    const format = value => {
      const seconds = Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
      return Math.floor(seconds / 60) + ':' + String(seconds % 60).padStart(2, '0');
    };
    if (currentTime) currentTime.textContent = format(audio.currentTime);
    if (totalTime) totalTime.textContent = format(canSeek ? audio.duration : 0);
    if (selected && Number.isFinite(audio.duration)) {
      const duration = durationLabels.find(label => label.dataset.duration === selected.dataset.track);
      if (duration) {
        selected.dataset.localDuration = String(audio.duration);
        duration.title = 'Duração do arquivo local';
        const seconds = Math.floor(audio.duration);
        duration.textContent = Math.floor(seconds / 60) + ':' + String(seconds % 60).padStart(2, '0');
      }
    }
  }
  function reportError(message) {
    wantsPlay = false;
    updateButtons();
    if (!reportedError) { reportedError = true; notify(message, false); }
  }
  function stop() {
    attempt++;
    wantsPlay = false;
    audio.pause();
    updateButtons();
  }
  async function play() {
    const currentAttempt = ++attempt;
    wantsPlay = true;
    reportedError = false;
    try {
      if (audio.ended) audio.currentTime = 0;
      await audio.play();
      if (currentAttempt === attempt) updateButtons();
    } catch (error) {
      if (currentAttempt !== attempt || error.name === 'AbortError') return;
      reportError(error.name === 'NotAllowedError'
        ? 'O navegador bloqueou a reprodução. Clique novamente em reproduzir.'
        : 'Não foi possível reproduzir a música. Verifique se o servidor Node.js está atualizado e em execução.');
    }
  }
  function selectTrack(button, { restart = false } = {}) {
    if (!button?.dataset.src) {
      notify('Esta faixa ainda não possui um arquivo de áudio.', false);
      return;
    }
    if (selected === button && !restart) {
      if (wantsPlay || !audio.paused) stop();
      else return play();
      return;
    }
    stop();
    selected = button;
    audio.src = button.dataset.src;
    title.textContent = button.dataset.title;
    artist.textContent = button.dataset.artist;
    progress.value = 0;
    progress.disabled = true;
    onTrackChange();
    return play();
  }
  function toggle() {
    if (!selected) return selectTrack(buttons.find(button => button.dataset.src));
    if (wantsPlay || !audio.paused) stop();
    else return play();
  }
  function moveTrack(direction, { fromEnded = false } = {}) {
    const playlist = buttons.filter(button => button.dataset.src);
    if (!playlist.length) return;
    const currentIndex = playlist.indexOf(selected);
    if (fromEnded && !shuffle && repeatMode === 'off' && currentIndex === playlist.length - 1) {
      wantsPlay = false;
      audio.currentTime = 0;
      updateButtons();
      updateProgress();
      return;
    }
    let index;
    if (shuffle && playlist.length > 1) {
      do { index = Math.floor(Math.random() * playlist.length); } while (index === currentIndex);
    } else index = currentIndex === -1 ? 0 : (currentIndex + direction + playlist.length) % playlist.length;
    return selectTrack(playlist[index], { restart: true });
  }
  function seek() {
    if (progress.disabled || !selected || !Number.isFinite(audio.duration) || audio.duration <= 0) return;
    const fraction = Number(progress.value);
    if (!Number.isFinite(fraction)) return;
    audio.currentTime = Math.max(0, Math.min(1, fraction)) * audio.duration;
    updateProgress();
  }
  progress.addEventListener('input', seek);
  progress.disabled = true;
  if (previousButton) {
    previousButton.disabled = !buttons.some(button => button.dataset.src);
    previousButton.onclick = () => moveTrack(-1);
  }
  if (nextButton) {
    nextButton.disabled = !buttons.some(button => button.dataset.src);
    nextButton.onclick = () => moveTrack(1);
  }
  if (shuffleButton) shuffleButton.onclick = () => {
    shuffle = !shuffle;
    shuffleButton.dataset.active = String(shuffle);
    shuffleButton.setAttribute('aria-pressed', String(shuffle));
    shuffleButton.setAttribute('aria-label', shuffle ? 'Desativar reprodução aleatória' : 'Ativar reprodução aleatória');
  };
  if (repeatButton) repeatButton.onclick = () => {
    repeatMode = repeatMode === 'off' ? 'all' : repeatMode === 'all' ? 'one' : 'off';
    repeatButton.dataset.active = String(repeatMode !== 'off');
    repeatButton.dataset.mode = repeatMode;
    repeatButton.setAttribute('aria-pressed', String(repeatMode !== 'off'));
    repeatButton.setAttribute('aria-label', repeatMode === 'one' ? 'Repetir esta música' : repeatMode === 'all' ? 'Repetir todas as músicas' : 'Ativar repetição');
    setIcon(repeatButton, repeatMode === 'one' ? 'repeat-once' : 'repeat');
  };
  audio.addEventListener('emptied', () => { progress.value = 0; progress.disabled = true; });
  audio.addEventListener('playing', () => { wantsPlay = true; updateButtons(); });
  audio.addEventListener('pause', () => { wantsPlay = false; updateButtons(); });
  audio.addEventListener('ended', () => {
    wantsPlay = false;
    if (repeatMode === 'one' && selected) selectTrack(selected, { restart: true });
    else moveTrack(1, { fromEnded: true });
  });
  audio.addEventListener('timeupdate', updateProgress);
  audio.addEventListener('loadedmetadata', updateProgress);
  audio.addEventListener('durationchange', updateProgress);
  audio.addEventListener('error', () => {
    if (selected) reportError('Não foi possível carregar o arquivo de áudio. Confira se ele existe na pasta de músicas.');
  });
  let previousVolume = Math.max(Number(volume.value) || 50, 1);
  function updateMuteButton() {
    if (!muteButton) return;
    const muted = audio.muted || audio.volume === 0;
    setIcon(muteButton, muted ? 'speaker-slash' : 'speaker-high');
    muteButton.setAttribute('aria-label', muted ? 'Desmutar' : 'Mutar');
    muteButton.setAttribute('aria-pressed', String(muted));
  }
  volume.addEventListener('input', () => {
    const value = Number(volume.value);
    audio.volume = value / 100;
    if (value > 0) { previousVolume = value; audio.muted = false; }
    updateMuteButton();
  });
  if (muteButton) muteButton.onclick = () => {
    const muted = audio.muted || audio.volume === 0;
    if (muted) {
      audio.muted = false;
      if (audio.volume === 0) { audio.volume = previousVolume / 100; volume.value = previousVolume; }
    } else { previousVolume = Math.max(Number(volume.value) || 50, 1); audio.muted = true; }
    updateMuteButton();
  };
  audio.addEventListener('volumechange', updateMuteButton);
  audio.volume = Number(volume.value) / 100;
  updateMuteButton();
  updateProgress();
  buttons.forEach(button => { button.onclick = () => selectTrack(button); });
  playButton.onclick = toggle;
  updateButtons();
  return { stop, toggle, selectTrack, resume: play, getSelectedTrack: () => selected };
}

function createVideoViewer({ button, dialog, stage, video, closeButton, heading, errorLabel, audio, volume, player, notify, document: doc }) {
  let active = false;
  let enteredFullscreen = false;
  let startTime = 0;
  let wasPlaying = false;
  let failed = false;
  let generation = 0;

  function finish() {
    if (!active) return;
    active = false;
    generation++;
    const resume = failed ? wasPlaying : !video.paused && !video.ended;
    const position = video.readyState > 0 && !failed ? video.currentTime : startTime;
    video.pause();
    if (Number.isFinite(audio.duration)) audio.currentTime = Math.min(position, audio.duration);
    audio.volume = video.volume;
    audio.muted = video.muted;
    volume.value = Math.round(video.volume * 100);
    video.removeAttribute('src');
    video.load();
    if (doc.fullscreenElement && stage.contains(doc.fullscreenElement)) doc.exitFullscreen().catch(() => {});
    if (dialog.open) dialog.close();
    if (resume) player.resume();
    button.focus();
  }

  function open() {
    if (active) return;
    const track = player.getSelectedTrack();
    if (!track) { notify('Selecione uma música antes de abrir o videoclipe.', false); return; }
    if (!track.dataset.video) { notify('Esta música ainda não tem videoclipe cadastrado.', false); return; }
    const currentGeneration = ++generation;
    active = true;
    failed = false;
    enteredFullscreen = false;
    startTime = Number.isFinite(audio.currentTime) ? audio.currentTime : 0;
    wasPlaying = !audio.paused;
    player.stop();
    heading.textContent = track.dataset.title;
    errorLabel.textContent = '';
    video.volume = audio.volume;
    video.muted = audio.muted;
    video.src = track.dataset.video;
    dialog.showModal();
    closeButton.focus();
    // Solicita tela cheia dentro do clique, antes de qualquer espera de rede.
    if (stage.requestFullscreen) {
      try {
        stage.requestFullscreen().catch(() => {
          if (active && currentGeneration === generation) errorLabel.textContent = 'Tela cheia indisponível. O clipe continua aberto nesta janela.';
        });
      } catch { errorLabel.textContent = 'Tela cheia indisponível. O clipe continua aberto nesta janela.'; }
    }
    video.play().catch(error => {
      if (!active || currentGeneration !== generation || error.name === 'AbortError') return;
      failed = true;
      errorLabel.textContent = 'Não foi possível iniciar o clipe. Tente o botão de reprodução do vídeo.';
    });
  }
  video.addEventListener('loadedmetadata', () => {
    if (active && Number.isFinite(video.duration)) video.currentTime = Math.min(startTime, Math.max(0, video.duration - 0.1));
  });
  video.addEventListener('playing', () => { failed = false; });
  video.addEventListener('error', () => {
    if (active) { failed = true; errorLabel.textContent = 'Não foi possível carregar o videoclipe. Confira o arquivo e reinicie o servidor Node.js.'; }
  });
  doc.addEventListener('fullscreenchange', () => {
    if (!active) return;
    if (doc.fullscreenElement && stage.contains(doc.fullscreenElement)) enteredFullscreen = true;
    else if (enteredFullscreen && !doc.fullscreenElement) finish();
  });
  dialog.addEventListener('cancel', event => { event.preventDefault(); finish(); });
  dialog.addEventListener('close', finish);
  closeButton.onclick = finish;
  button.onclick = open;
  return { open, close: finish };
}

// Enriquece apenas as faixas cadastradas, sem interromper a reprodução local.
function createLibraryFeatures({ username, user, buttons, rows, allMusicItems, movieCards, player, switchTab, notify, elements, document: doc, storage = localStorage }) {
  const playable = [...buttons].filter(button => button.dataset.src);
  const byId = new Map(playable.map(button => [button.dataset.track, button]));
  const rowById = new Map([...rows].map(row => [row.dataset.musicRow, row]));
  const storageKey = `nexus-library:${username}`;
  const defaults = { liked: [], pinned: [], recent: [], tastes: [], playlists: {}, settings: { compact: false, showSources: true } };
  let state = structuredClone(defaults);
  let collection = 'all';
  let lastContentTab = 'movies';

  try {
    const saved = JSON.parse(storage.getItem(storageKey));
    if (saved && typeof saved === 'object') state = {
      liked: Array.isArray(saved.liked) ? saved.liked.filter(id => byId.has(String(id))).map(String) : [],
      pinned: Array.isArray(saved.pinned) ? saved.pinned.filter(id => byId.has(String(id))).map(String) : [],
      recent: Array.isArray(saved.recent) ? saved.recent.filter(id => byId.has(String(id))).map(String).slice(0, 20) : [],
      tastes: Array.isArray(saved.tastes) ? saved.tastes.filter(value => typeof value === 'string') : [],
      playlists: saved.playlists && typeof saved.playlists === 'object' && !Array.isArray(saved.playlists)
        ? Object.fromEntries(Object.entries(saved.playlists).filter(([name, ids]) => name.trim() && Array.isArray(ids)).map(([name, ids]) => [name.slice(0, 60), ids.filter(id => byId.has(String(id))).map(String)])) : {},
      settings: { ...defaults.settings, ...(saved.settings || {}) }
    };
  } catch { state = structuredClone(defaults); }

  function save() { storage.setItem(storageKey, JSON.stringify(state)); }
  function toggle(list, id) {
    const index = list.indexOf(id);
    if (index === -1) list.push(id); else list.splice(index, 1);
  }
  function normalized(value) {
    return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  }
  function updateButtons() {
    for (const [id, row] of rowById) {
      const liked = state.liked.includes(id), pinned = state.pinned.includes(id);
      const like = row.querySelector('[data-like]'), pin = row.querySelector('[data-pin]');
      like.dataset.active = String(liked);
      like.setAttribute('aria-pressed', String(liked));
      like.setAttribute('aria-label', liked ? 'Remover dos favoritos' : 'Curtir música');
      like.querySelector('i').className = 'ph ph-heart';
      pin.dataset.active = String(pinned);
      pin.setAttribute('aria-pressed', String(pinned));
      pin.setAttribute('aria-label', pinned ? 'Desafixar música' : 'Fixar música');
      pin.querySelector('i').className = 'ph ph-push-pin';
    }
  }
  function populatePlaylists() {
    elements.playlists.replaceChildren();
    const names = Object.keys(state.playlists).sort((a, b) => a.localeCompare(b, 'pt-BR'));
    elements.emptyPlaylists.hidden = names.length !== 0;
    for (const name of names) {
      const item = elements.playlistTemplate.content.firstElementChild.cloneNode(true);
      const open = item.querySelector('[data-open-playlist]');
      open.querySelector('[data-playlist-name]').textContent = name;
      open.querySelector('[data-playlist-count]').textContent = state.playlists[name].length;
      open.onclick = () => showCollection('playlist', name);
      item.querySelector('[data-delete-playlist]').onclick = () => {
        delete state.playlists[name];
        if (collection === `playlist:${name}`) showCollection('all');
        save(); populatePlaylists();
        notify('Playlist removida.');
      };
      elements.playlists.append(item);
    }
    for (const row of rowById.values()) {
      const select = row.querySelector('[data-add-playlist]');
      select.replaceChildren();
      const placeholder = doc.createElement('option');
      placeholder.value = ''; placeholder.textContent = 'Adicionar à playlist…';
      select.append(placeholder);
      for (const name of names) {
        const option = doc.createElement('option');
        option.value = name; option.textContent = name;
        select.append(option);
      }
    }
  }
  function applySettings() {
    doc.body.classList.toggle('compact-library', Boolean(state.settings.compact));
    doc.body.classList.toggle('hide-music-sources', !state.settings.showSources);
    elements.compact.checked = Boolean(state.settings.compact);
    elements.showSources.checked = Boolean(state.settings.showSources);
  }
  function visibleIds() {
    if (collection === 'liked') return state.liked;
    if (collection === 'pinned') return state.pinned;
    if (collection === 'recent') return state.recent;
    if (collection.startsWith('playlist:')) return state.playlists[collection.slice(9)] || [];
    return [...byId.keys()];
  }
  function applyMusicFilter() {
    const query = normalized(elements.musicSearch.value);
    const allowed = new Set(visibleIds());
    const tasteSet = new Set(state.tastes);
    let count = 0;
    for (const item of allMusicItems) {
      const button = item.querySelector('[data-track]');
      const id = button?.dataset.track;
      let visible = collection === 'all' ? true : Boolean(id && allowed.has(id));
      if (collection === 'releases') visible = Boolean(button?.dataset.release);
      if (query) visible = visible && normalized(item.textContent).includes(query);
      if (tasteSet.size && button?.dataset.src) {
        const genres = new Set((button.dataset.genres || '').split(',').filter(Boolean));
        visible = visible && [...tasteSet].some(taste => genres.has(taste));
      } else if (tasteSet.size && !button?.dataset.src) visible = false;
      item.hidden = !visible;
      if (visible) count++;
    }
    elements.musicEmpty.hidden = count !== 0;
    elements.collectionCount.textContent = `${count} ${count === 1 ? 'item' : 'itens'}`;
  }
  function showCollection(type, name = '') {
    collection = type === 'playlist' ? `playlist:${name}` : type;
    const titles = { all: 'Todas as músicas', liked: 'Músicas curtidas', pinned: 'Músicas fixadas', recent: 'Ouvidas recentemente', releases: 'Lançamentos' };
    elements.collectionTitle.textContent = type === 'playlist' ? name : titles[type];
    elements.libraryButtons.forEach(button => button.setAttribute('aria-pressed', String(button.dataset.library === type && type !== 'playlist')));
    switchTab('music');
    applyMusicFilter();
  }
  function recordRecent() {
    const id = player.getSelectedTrack()?.dataset.track;
    if (!id) return;
    state.recent = [id, ...state.recent.filter(item => item !== id)].slice(0, 20);
    save();
    if (collection === 'recent') applyMusicFilter();
  }
  function renderSearch() {
    const query = normalized(elements.globalSearch.value.trim());
    elements.searchResults.replaceChildren();
    if (!query) { switchTab(lastContentTab); return; }
    const matches = [];
    for (const button of playable) if (normalized(`${button.dataset.title} ${button.dataset.artist}`).includes(query)) matches.push({ type: 'Música', title: button.dataset.title, subtitle: button.dataset.artist, action: () => { elements.globalSearch.value = ''; showCollection('all'); player.selectTrack(button); } });
    for (const card of movieCards) if (normalized(card.textContent).includes(query)) matches.push({ type: 'Filme ou série', title: card.querySelector('h3')?.textContent || card.textContent.trim(), subtitle: 'Catálogo NEXUS', action: () => { elements.globalSearch.value = ''; switchTab('movies'); card.scrollIntoView({ behavior: 'smooth', block: 'center' }); } });
    for (const match of matches) {
      const result = elements.searchTemplate.content.firstElementChild.cloneNode(true);
      result.querySelector('[data-result-type]').textContent = match.type;
      result.querySelector('[data-result-title]').textContent = match.title;
      result.querySelector('[data-result-subtitle]').textContent = match.subtitle;
      result.onclick = match.action;
      elements.searchResults.append(result);
    }
    elements.searchEmpty.hidden = matches.length !== 0;
    switchTab('search');
  }
  function filterMovies() {
    const query = normalized(elements.movieSearch.value);
    let count = 0;
    for (const card of movieCards) {
      const visible = normalized(card.textContent).includes(query);
      card.hidden = !visible;
      if (visible) count++;
    }
    elements.movieEmpty.hidden = count !== 0;
  }
  function openProfile() {
    elements.profileName.textContent = username;
    elements.profileRole.textContent = user.role === 'admin' ? 'Administrador' : 'Usuário';
    elements.profilePlan.textContent = user.plan;
    elements.profileDialog.showModal();
  }

  for (const [id, row] of rowById) {
    row.querySelector('[data-like]').onclick = () => { toggle(state.liked, id); save(); updateButtons(); if (collection === 'liked') applyMusicFilter(); };
    row.querySelector('[data-pin]').onclick = () => { toggle(state.pinned, id); save(); updateButtons(); if (collection === 'pinned') applyMusicFilter(); };
    row.querySelector('[data-add-playlist]').onchange = event => {
      const name = event.target.value;
      if (!name) return;
      if (!state.playlists[name].includes(id)) state.playlists[name].push(id);
      save(); populatePlaylists(); event.target.value = '';
      notify(`Adicionada à playlist “${name}”.`);
    };
  }
  elements.newPlaylist.onclick = () => { elements.playlistForm.reset(); elements.playlistError.textContent = ''; elements.playlistDialog.showModal(); };
  elements.cancelPlaylist.onclick = () => elements.playlistDialog.close();
  elements.playlistForm.onsubmit = event => {
    event.preventDefault();
    const name = elements.playlistName.value.trim();
    if (!name || name.length > 60) { elements.playlistError.textContent = 'Use um nome de até 60 caracteres.'; return; }
    if (Object.hasOwn(state.playlists, name)) { elements.playlistError.textContent = 'Essa playlist já existe.'; return; }
    state.playlists[name] = []; save(); populatePlaylists(); elements.playlistDialog.close(); showCollection('playlist', name);
  };
  elements.libraryButtons.forEach(button => { button.onclick = () => showCollection(button.dataset.library); });
  elements.tasteButtons.forEach(button => {
    button.onclick = () => {
      toggle(state.tastes, button.dataset.taste); save();
      button.setAttribute('aria-pressed', String(state.tastes.includes(button.dataset.taste)));
      applyMusicFilter();
    };
    button.setAttribute('aria-pressed', String(state.tastes.includes(button.dataset.taste)));
  });
  elements.musicSearch.addEventListener('input', applyMusicFilter);
  elements.movieSearch.addEventListener('input', filterMovies);
  elements.globalSearch.addEventListener('input', renderSearch);
  elements.profileButton.onclick = openProfile;
  elements.closeProfile.onclick = () => elements.profileDialog.close();
  elements.compact.onchange = () => { state.settings.compact = elements.compact.checked; save(); applySettings(); };
  elements.showSources.onchange = () => { state.settings.showSources = elements.showSources.checked; save(); applySettings(); };
  updateButtons(); populatePlaylists(); applySettings(); applyMusicFilter(); filterMovies();
  return { recordRecent, showCollection, setLastTab: name => { if (name !== 'search') lastContentTab = name; } };
}


function createMetadataCatalog({ db, buttons, player, cover, sourceLinks, statusLabel, document: doc }) {
  const tracks = [...buttons].filter(button => button.dataset.src && button.dataset.queryArtist);
  let loading = null;
  let loaded = false;
  function image(node, url, title) {
    if (!node) return;
    node.hidden = !url;
    node.alt = 'Capa de ' + title;
    const placeholder = node.parentElement?.querySelector('[data-cover-placeholder]');
    const playerPlaceholder = node.parentElement?.querySelector('#song-cover-placeholder');
    if (placeholder) placeholder.textContent = String(title || 'M').trim().slice(0, 2).toUpperCase();
    if (placeholder) placeholder.hidden = Boolean(url);
    if (playerPlaceholder) playerPlaceholder.hidden = Boolean(url);
    if (url) {
      node.onerror = () => {
        node.hidden = true;
        if (placeholder) placeholder.hidden = false;
        if (playerPlaceholder) playerPlaceholder.hidden = false;
      };
      node.src = url;
    } else node.removeAttribute('src');
  }
  function links(container, metadata) {
    for (const provider of ['spotify', 'lastfm']) {
      const link = container.querySelector(`[data-provider="${provider}"]`);
      if (!link) continue;
      const url = metadata?.links?.[provider];
      link.hidden = !url;
      if (url) link.href = url;
      else link.removeAttribute('href');
    }
  }
  function syncPlayer() {
    const selected = player.getSelectedTrack();
    const metadata = selected?.metadata;
    image(cover, metadata?.coverUrl, selected?.dataset.title || 'música');
    links(sourceLinks, metadata);
    if (selected) {
      doc.getElementById('song-title').textContent = selected.dataset.title;
      doc.getElementById('song-artist').textContent = selected.dataset.artist;
    }
  }
  async function load() {
    if (loaded) return;
    if (loading) return loading;
    loading = (async () => {
      statusLabel.textContent = 'Buscando informações das músicas…';
      let successes = 0;
      for (const button of tracks) {
        try {
          const params = new URLSearchParams({ artist: button.dataset.queryArtist, track: button.dataset.queryTitle });
          const { metadata } = await db.request('/api/music/metadata?' + params);
          if (!metadata) continue;
          successes++;
          button.metadata = metadata;
          button.dataset.title = metadata.title;
          button.dataset.artist = metadata.artists.join(', ');
          const row = button.closest('[data-music-row]');
          row.querySelector('[data-music-title]').textContent = button.dataset.title;
          row.querySelector('[data-music-artist]').textContent = button.dataset.artist;
          image(row.querySelector('[data-music-cover]'), metadata.coverUrl, metadata.title);
          links(row, metadata);
          const label = row.querySelector('[data-duration]');
          if (metadata.durationMs && !button.dataset.localDuration) {
            const seconds = Math.floor(metadata.durationMs / 1000);
            label.textContent = Math.floor(seconds / 60) + ':' + String(seconds % 60).padStart(2, '0');
            label.title = 'Duração informada pelo catálogo; o arquivo local pode ter outra duração.';
          }
          syncPlayer();
        } catch { /* Mantém título, artista e arquivo locais quando a consulta falhar. */ }
      }
      loaded = successes === tracks.length && tracks.length > 0;
      statusLabel.textContent = successes === tracks.length && tracks.length
        ? 'Informações das músicas atualizadas.'
        : successes ? 'Algumas músicas não têm informações adicionais disponíveis.' : 'Informações adicionais indisponíveis. Exibindo os dados locais.';
    })().finally(() => { loading = null; });
    return loading;
  }
  return { load, syncPlayer };
}

function createOnlineCatalog({ db, search, template, discover, results, collectionTitle, collectionCount }) {
  let discoverLoaded = false;
  let timer = null;
  let requestId = 0;
  function durationLabel(milliseconds) {
    if (!milliseconds) return '';
    const seconds = Math.floor(milliseconds / 1000);
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  }
  function render(target, result, query = '') {
    target.list.replaceChildren();
    if (target.title) target.title.textContent = query ? `Resultados para “${query}”` : 'Ranking global do Spotify';
    if (query) {
      collectionTitle.textContent = 'Pesquisa no Spotify';
      collectionCount.textContent = `${result.tracks.length} resultados`;
    }
    result.tracks.forEach((track, index) => {
      const card = template.content.firstElementChild.cloneNode(true);
      const spotify = track.links?.spotify;
      const lastfm = track.links?.lastfm;
      const primary = spotify;
      const cover = card.querySelector('[data-online-cover]');
      const placeholder = card.querySelector('[data-online-placeholder]');
      placeholder.textContent = track.title.trim().slice(0, 2).toUpperCase();
      if (track.coverUrl) {
        cover.src = track.coverUrl;
        cover.alt = `Capa de ${track.title}`;
        cover.hidden = false;
        placeholder.hidden = true;
        cover.onerror = () => { cover.hidden = true; placeholder.hidden = false; };
      }
      const primaryLink = card.querySelector('[data-online-primary]');
      if (primary) primaryLink.href = primary;
      else { primaryLink.removeAttribute('href'); primaryLink.setAttribute('aria-disabled', 'true'); }
      primaryLink.setAttribute('aria-label', `${primary ? 'Abrir' : 'Ver'} ${track.title}${track.source ? ' no ' + track.source : ''}`);
      card.querySelector('[data-online-rank]').textContent = query ? (track.kind || 'Música') : String(index + 1).padStart(2, '0');
      card.querySelector('[data-online-title]').textContent = track.title;
      card.querySelector('[data-online-artist]').textContent = track.kind === 'Artista' ? 'Perfil de artista' : track.artists.join(', ');
      card.querySelector('[data-online-duration]').textContent = durationLabel(track.durationMs);
      for (const [selector, url] of [['[data-online-spotify]', spotify], ['[data-online-lastfm]', lastfm]]) {
        const link = card.querySelector(selector);
        link.hidden = !url;
        if (url) link.href = url;
      }
      target.list.append(card);
    });
    const credentialsInvalid = result.providers?.spotify === 'invalid_credentials';
    target.status.textContent = result.tracks.length
      ? `${result.tracks.length} ${query ? 'resultados encontrados' : 'músicas no ranking'}.`
      : credentialsInvalid ? 'As credenciais do Spotify foram recusadas. Atualize o Client ID e o Client Secret no .env.' : 'Nenhum resultado disponível no Spotify.';
  }
  async function request(query = '') {
    const current = ++requestId;
    results.section.hidden = !query;
    discover.section.hidden = Boolean(query);
    const target = query ? results : discover;
    target.status.textContent = query ? 'Pesquisando músicas, artistas e álbuns no Spotify…' : 'Carregando o ranking global do Spotify…';
    try {
      const endpoint = query
        ? '/api/music/search?' + new URLSearchParams({ q: query, limit: '20' })
        : '/api/music/discover?limit=12';
      const result = await db.request(endpoint);
      if (current !== requestId) return;
      render(target, result, query);
      if (!query) discoverLoaded = true;
    } catch (error) {
      if (current !== requestId) return;
      target.list.replaceChildren();
      target.status.textContent = error.message;
    }
  }
  search.addEventListener('input', () => {
    clearTimeout(timer);
    const query = search.value.trim();
    timer = setTimeout(() => request(query), query ? 400 : 200);
  });
  return { load() { if (!discoverLoaded && !search.value.trim()) return request(); } };
}

function recentMangaItems(items, limit = 5) {
  return [...items].sort((a,b)=>String(b.addedAt||b.added_at||'').localeCompare(String(a.addedAt||a.added_at||''))).slice(0,limit);
}

function clampReaderZoom(value) {
  return Math.max(.6,Math.min(3,Math.round(Number(value)*100)/100));
}

function isReaderExpanded(fullscreenElement, readerDialog, expandedFallback = false) {
  return fullscreenElement === readerDialog || Boolean(expandedFallback);
}

function createMangaExperience({ db, elements, document: doc, user, notify = () => {} }) {
  const on = (node, event, handler) => node?.addEventListener(event, handler);
  let provider = 'mangadex', catalogPage = 0, requestId = 0, catalogMode = 'catalog';
  let currentSeriesId = '', currentBook = null, chapterBooks = [], pages = [], pageIndex = 0;
  let readerMode = user.readerMode === 'continuous' ? 'continuous' : 'paged', zoom = 1;
  let progressTimer, touchStart = null, pinchStart = null, panStart = null;
  let heroItems = [], heroIndex = 0, heroTimer = null, heroTouchStart = null;
  const endpoint = () => `/api/${provider}`;
  const reducedMotion = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

  function cardData(item) {
    return { id:item.id || item.series_id, title:item.title || 'Sem título', summary:item.summary || '', addedAt:item.addedAt || item.added_at || '', thumbnailUrl:item.thumbnailUrl || item.cover_url || '', authors:item.authors || [], status:item.status || '', booksCount:item.booksCount, booksReadCount:item.booksReadCount || 0, provider:item.provider || provider };
  }
  function stopHeroTimer() { clearInterval(heroTimer); heroTimer = null; }
  function startHeroTimer() {
    stopHeroTimer();
    if (reducedMotion || heroItems.length < 2) return;
    heroTimer = setInterval(() => showHero(heroIndex + 1), 7000);
  }
  function showHero(index, interacted = false) {
    if (!heroItems.length) return;
    heroIndex = (index + heroItems.length) % heroItems.length;
    elements.heroTrack?.querySelectorAll('.manga-hero-slide').forEach((slide, slideIndex) => {
      const active = slideIndex === heroIndex;
      slide.hidden = !active;
      slide.setAttribute('aria-hidden', String(!active));
    });
    elements.heroDots?.querySelectorAll('button').forEach((dot, dotIndex) => dot.setAttribute('aria-current', String(dotIndex === heroIndex)));
    if (interacted) stopHeroTimer();
  }
  function renderHero(items) {
    if (!elements.hero || !elements.heroTrack) return;
    heroItems = recentMangaItems(items).map(cardData);
    elements.heroTrack.replaceChildren(); elements.heroDots?.replaceChildren();
    elements.heroStatus.textContent = heroItems.length ? '' : 'Nenhum mangá recente disponível no momento.';
    elements.heroPrevious.hidden = elements.heroNext.hidden = heroItems.length < 2;
    heroItems.forEach((item,index) => {
      const slide=doc.createElement('article');slide.className='manga-hero-slide';slide.hidden=index!==0;slide.setAttribute('aria-roledescription','slide');slide.setAttribute('aria-label',`${index+1} de ${heroItems.length}`);
      const image=doc.createElement('img');image.className='manga-hero-image';image.alt='';image.src=item.thumbnailUrl;image.loading=index===0?'eager':'lazy';if(index===0)image.fetchPriority='high';image.onerror=()=>{image.hidden=true;slide.classList.add('without-image')};
      const shade=doc.createElement('div');shade.className='manga-hero-shade';
      const copy=doc.createElement('div');copy.className='manga-hero-copy';const eyebrow=doc.createElement('p');eyebrow.className='user-eyebrow';eyebrow.textContent='ADICIONADO RECENTEMENTE';const title=doc.createElement('h2');title.textContent=item.title;const summary=doc.createElement('p');summary.textContent=item.summary||'Conheça esta obra recém-adicionada ao catálogo.';const link=doc.createElement('a');link.href=`/mangas/${item.provider}/${encodeURIComponent(item.id)}`;link.innerHTML='<i class="ph ph-book-open"></i> Ver mangá';copy.append(eyebrow,title,summary,link);slide.append(image,shade,copy);elements.heroTrack.append(slide);
      if(elements.heroDots){const dot=doc.createElement('button');dot.type='button';dot.setAttribute('aria-label',`Mostrar destaque ${index+1}: ${item.title}`);dot.setAttribute('aria-current',String(index===0));dot.onclick=()=>showHero(index,true);elements.heroDots.append(dot);}
    });
    heroIndex=0;startHeroTimer();
  }
  function renderSeries(items, total = items.length, playlistId = null) {
    elements.grid.replaceChildren(); elements.count.textContent = `${total} ${total === 1 ? 'obra' : 'obras'}`; elements.empty.hidden = Boolean(items.length);
    for (const raw of items) {
      const item=cardData(raw), card=elements.seriesTemplate.content.firstElementChild.cloneNode(true), cover=card.querySelector('[data-manga-cover]'), placeholder=card.querySelector('[data-manga-placeholder]');
      cover.src=item.thumbnailUrl;cover.alt=`Capa de ${item.title}`;cover.onload=()=>placeholder.hidden=true;cover.onerror=()=>{cover.hidden=true;placeholder.hidden=false};
      card.querySelector('[data-manga-title]').textContent=item.title;card.querySelector('[data-manga-author]').textContent=item.authors.join(', ')||item.status||'Mangá';
      card.querySelector('[data-manga-books]').textContent=item.booksCount==null?'Ver capítulos':`${item.booksCount} capítulos`;card.querySelector('[data-manga-progress]').textContent=item.booksReadCount?`${item.booksReadCount} lidos`:'Não iniciado';
      card.querySelector('[data-manga-open]').onclick=()=>location.assign(`/mangas/${raw.provider||provider}/${encodeURIComponent(item.id)}`);
      if(playlistId){const remove=doc.createElement('button');remove.type='button';remove.className='manga-remove-from-list';remove.innerHTML='<i class="ph ph-trash"></i> Remover da lista';remove.onclick=async()=>{await db.request(`/api/manga/playlists/${playlistId}/items/${encodeURIComponent(raw.provider||provider)}/${encodeURIComponent(item.id)}`,{method:'DELETE'});card.remove();notify('Mangá removido da lista.');};card.querySelector('.manga-card-copy').append(remove);}
      elements.grid.append(card);
    }
  }
  async function load(force=false) {
    const current=++requestId;elements.grid.replaceChildren();elements.empty.hidden=true;elements.refresh.dataset.loading='true';elements.status.textContent='Carregando catálogo…';
    try {
      if(catalogMode==='favorites') { const result=await db.request('/api/manga/favorites');if(current!==requestId)return;renderSeries(result.items);elements.previous.disabled=elements.next.disabled=true;elements.page.textContent='Favoritos'; }
      else { const query=elements.search.value.trim();const result=await db.request(endpoint()+'/series?'+new URLSearchParams({q:query,size:'30',page:catalogPage,lang:'pt-br'}));if(current!==requestId)return;if(!query&&catalogPage===0)renderHero(result.content);renderSeries(result.content,result.totalElements);elements.previous.disabled=catalogPage===0;elements.next.disabled=result.last;elements.page.textContent=`Página ${catalogPage+1}`; }
      elements.status.textContent='';
    } catch(error){if(current===requestId){elements.grid.replaceChildren();elements.count.textContent='';elements.status.textContent=error.message;if(elements.heroStatus&&!heroItems.length)elements.heroStatus.textContent='Não foi possível carregar os destaques.';}}
    finally{if(current===requestId)delete elements.refresh.dataset.loading;}
  }
  async function setView(view) {
    elements.grid.dataset.layout=view; if(elements.viewToggle)elements.viewToggle.innerHTML=`<i class="ph ph-${view==='grid'?'list':'squares-four'}"></i>`;
    try{await db.request('/api/account/preferences',{method:'PUT',body:JSON.stringify({catalogView:view,readerMode})});}catch(error){notify(error.message,false);}
  }
  async function loadPlaylists(open=false) {
    const result=await db.request('/api/manga/playlists');
    if(elements.addPlaylist){elements.addPlaylist.replaceChildren(new Option('Adicionar à lista…',''));for(const p of result.playlists)elements.addPlaylist.add(new Option(`${p.name} (${p.item_count})`,p.id));}
    if(elements.playlistsList){elements.playlistsList.replaceChildren();for(const p of result.playlists){const row=doc.createElement('article');row.className='manga-playlist-row';const title=doc.createElement('strong');title.textContent=`${p.name} · ${p.item_count}`;const openButton=doc.createElement('button');openButton.type='button';openButton.textContent='Abrir';openButton.onclick=async()=>{const data=await db.request(`/api/manga/playlists/${p.id}`);renderSeries(data.items,data.items.length,p.id);elements.playlistsDialog.close();elements.page.textContent=p.name;};const rename=doc.createElement('button');rename.type='button';rename.textContent='Renomear';rename.onclick=async()=>{const name=prompt('Novo nome da lista',p.name)?.trim();if(!name)return;await db.request(`/api/manga/playlists/${p.id}`,{method:'PUT',body:JSON.stringify({name})});loadPlaylists();};const remove=doc.createElement('button');remove.type='button';remove.textContent='Excluir';remove.onclick=async()=>{await db.request(`/api/manga/playlists/${p.id}`,{method:'DELETE'});loadPlaylists();};row.append(title,openButton,rename,remove);elements.playlistsList.append(row);}}
    if(open&&!elements.playlistsDialog.open)elements.playlistsDialog.showModal();return result.playlists;
  }
  function progressUrl(){return `/api/manga/progress/${provider}/${encodeURIComponent(currentSeriesId)}/${encodeURIComponent(currentBook.id)}`;}
  function saveProgress(){clearTimeout(progressTimer);if(!currentBook)return;progressTimer=setTimeout(()=>db.request(progressUrl(),{method:'PUT',body:JSON.stringify({page:pageIndex+1,mode:readerMode})}).catch(()=>{}),300);}
  function pageUrl(page){return endpoint()+`/books/${encodeURIComponent(currentBook.id)}/pages/${page.number}`;}
  function applyZoom() {
    const available=Math.max(280,elements.readerStage.clientWidth-40),base=Math.min(1100,available),width=Math.round(base*zoom);
    elements.readerStage.style.setProperty('--reader-zoom',String(zoom));
    const targets=[elements.readerImage,...(elements.readerContinuous?[...elements.readerContinuous.querySelectorAll('img')]:[])];
    for(const image of targets){image.style.width=`${width}px`;image.style.maxWidth='none';image.style.marginInline=width<=available?'auto':'0';}
    if(elements.zoomReset){elements.zoomReset.disabled=Math.abs(zoom-1)<.01;elements.zoomReset.setAttribute('aria-label',`Restaurar zoom. Escala atual ${Math.round(zoom*100)}%`);}
  }
  function setZoom(value){zoom=clampReaderZoom(value);applyZoom();}
  function showPage(index) {
    if(!currentBook||!pages.length)return;pageIndex=Math.max(0,Math.min(pages.length-1,index));const page=pages[pageIndex];elements.readerImage.hidden=false;elements.readerImage.src=pageUrl(page);elements.readerCounter.textContent=`${pageIndex+1} / ${pages.length}`;elements.readerPrevious.disabled=pageIndex===0;elements.readerNext.disabled=pageIndex===pages.length-1;elements.readerStatus.textContent='';elements.readerStage.scrollTo({top:0,behavior:'instant'});applyZoom();saveProgress();
  }
  function renderContinuous() {
    elements.readerImage.hidden=true;elements.readerContinuous.hidden=false;elements.readerContinuous.replaceChildren();
    pages.forEach((page,index)=>{const img=doc.createElement('img');img.loading=index<2?'eager':'lazy';img.alt=`Página ${index+1}`;img.src=pageUrl(page);img.dataset.index=index;elements.readerContinuous.append(img);});applyZoom();
    const observer=new IntersectionObserver(entries=>{const visible=entries.filter(e=>e.isIntersecting).sort((a,b)=>b.intersectionRatio-a.intersectionRatio)[0];if(visible){pageIndex=Number(visible.target.dataset.index);elements.readerCounter.textContent=`${pageIndex+1} / ${pages.length}`;saveProgress();}},{root:elements.readerStage,threshold:[.35,.7]});elements.readerContinuous.querySelectorAll('img').forEach(img=>observer.observe(img));
  }
  async function loadComments(){if(!elements.commentsList||!currentBook)return;try{const data=await db.request(`/api/manga/comments/${provider}/${encodeURIComponent(currentSeriesId)}/${encodeURIComponent(currentBook.id)}`);elements.commentsList.replaceChildren();for(const c of data.comments){const row=doc.createElement('article');const header=doc.createElement('strong');header.textContent=c.author;const text=doc.createElement('p');text.textContent=c.content;const actions=doc.createElement('div');if(c.own){const edit=doc.createElement('button');edit.type='button';edit.textContent='Editar';edit.onclick=async()=>{const content=prompt('Editar comentário',c.content)?.trim();if(!content)return;await db.request(`/api/manga/comments/${c.id}`,{method:'PUT',body:JSON.stringify({content})});loadComments();};const remove=doc.createElement('button');remove.type='button';remove.textContent='Excluir';remove.onclick=async()=>{await db.request(`/api/manga/comments/${c.id}`,{method:'DELETE'});loadComments();};actions.append(edit,remove);}else{const report=doc.createElement('button');report.type='button';report.textContent='Denunciar';report.onclick=async()=>{const reason=prompt('Motivo da denúncia')?.trim();if(!reason)return;await db.request(`/api/manga/comments/${c.id}/report`,{method:'POST',body:JSON.stringify({reason})});notify('Denúncia registrada.');};actions.append(report);}row.append(header,text,actions);elements.commentsList.append(row);}elements.commentsStatus.textContent=data.comments.length?'':'Ainda não há comentários.';}catch(error){elements.commentsStatus.textContent=error.message;}}
  async function openBook(book,books=chapterBooks,seriesId=currentSeriesId) {
    currentBook=book;chapterBooks=books;currentSeriesId=seriesId;pageIndex=0;pages=[];zoom=1;elements.readerTitle.textContent=book.title;elements.readerCounter.textContent='0 / 0';elements.readerStatus.textContent='Preparando leitura…';elements.readerContinuous?.replaceChildren();if(!elements.readerDialog.open)elements.readerDialog.showModal();
    const index=chapterBooks.findIndex(item=>item.id===book.id);if(elements.readerPrevChapter)elements.readerPrevChapter.disabled=index<=0;if(elements.readerNextChapter)elements.readerNextChapter.disabled=index<0||index>=chapterBooks.length-1;
    try{const [result,saved]=await Promise.all([db.request(endpoint()+`/books/${encodeURIComponent(book.id)}/pages`),db.request(progressUrl())]);pages=result.pages||[];readerMode=saved.progress.mode==='continuous'?'continuous':'paged';pageIndex=Math.max(0,Math.min(pages.length-1,Number(saved.progress.page||1)-1));if(!pages.length){elements.readerStatus.textContent='Este capítulo não possui páginas disponíveis.';return;}if(readerMode==='continuous'){renderContinuous();setTimeout(()=>elements.readerContinuous.children[pageIndex]?.scrollIntoView({block:'start'}),0);}else{elements.readerContinuous.hidden=true;showPage(pageIndex);}elements.readerMode?.setAttribute('aria-pressed',String(readerMode==='continuous'));loadComments();}catch(error){elements.readerStatus.textContent=error.message;}
  }
  function adjacentChapter(delta){const i=chapterBooks.findIndex(b=>b.id===currentBook?.id),next=chapterBooks[i+delta];if(next)openBook(next,chapterBooks,currentSeriesId);}
  on(elements.search,'input',()=>{clearTimeout(elements.search._timer);catalogPage=0;elements.search._timer=setTimeout(()=>load(true),450)});on(elements.refresh,'click',()=>load(true));on(elements.previous,'click',()=>{catalogPage=Math.max(0,catalogPage-1);load(true)});on(elements.next,'click',()=>{catalogPage++;load(true)});
  on(elements.heroPrevious,'click',()=>showHero(heroIndex-1,true));on(elements.heroNext,'click',()=>showHero(heroIndex+1,true));
  on(elements.hero,'mouseenter',stopHeroTimer);on(elements.hero,'mouseleave',startHeroTimer);on(elements.hero,'focusin',stopHeroTimer);on(elements.hero,'focusout',event=>{if(!elements.hero.contains(event.relatedTarget))startHeroTimer()});
  on(elements.hero,'touchstart',event=>{if(event.touches.length===1)heroTouchStart=event.touches[0].clientX;stopHeroTimer()},{passive:true});on(elements.hero,'touchend',event=>{if(heroTouchStart==null)return;const distance=event.changedTouches[0].clientX-heroTouchStart;heroTouchStart=null;if(Math.abs(distance)>45)showHero(heroIndex+(distance<0?1:-1),true)},{passive:true});
  on(elements.showCatalog,'click',()=>{catalogMode='catalog';catalogPage=0;load(true)});on(elements.showFavorites,'click',()=>{catalogMode='favorites';load(true)});on(elements.showPlaylists,'click',()=>loadPlaylists(true));on(elements.viewToggle,'click',()=>setView(elements.grid.dataset.layout==='list'?'grid':'list'));
  on(elements.playlistsClose,'click',()=>elements.playlistsDialog.close());on(elements.playlistForm,'submit',async event=>{event.preventDefault();try{await db.request('/api/manga/playlists',{method:'POST',body:JSON.stringify({name:elements.playlistName.value.trim()})});elements.playlistForm.reset();elements.playlistStatus.textContent='Lista criada.';loadPlaylists();}catch(error){elements.playlistStatus.textContent=error.message;}});
  let expandedFallback=false;
  function syncFullscreen(){const active=isReaderExpanded(doc.fullscreenElement,elements.readerDialog,expandedFallback);elements.readerFullscreen?.setAttribute('aria-pressed',String(active));if(elements.readerFullscreen)elements.readerFullscreen.innerHTML=`<i class="ph ph-corners-${active?'in':'out'}"></i>`;elements.readerDialog.classList.toggle('reader-expanded',expandedFallback);}
  async function toggleFullscreen(){if(doc.fullscreenElement===elements.readerDialog){await doc.exitFullscreen();return;}if(expandedFallback){expandedFallback=false;syncFullscreen();return;}try{if(typeof elements.readerDialog.requestFullscreen!=='function')throw new Error('unsupported');await elements.readerDialog.requestFullscreen();}catch{expandedFallback=true;elements.readerStatus.textContent='Tela cheia não disponível neste navegador. O leitor foi expandido dentro da página.';syncFullscreen();}}
  on(elements.readerClose,'click',async()=>{expandedFallback=false;if(doc.fullscreenElement===elements.readerDialog)try{await doc.exitFullscreen()}catch{}elements.readerDialog.close();syncFullscreen()});on(elements.readerFullscreen,'click',toggleFullscreen);doc.addEventListener('fullscreenchange',syncFullscreen);on(elements.readerPrevious,'click',()=>showPage(pageIndex-1));on(elements.readerNext,'click',()=>showPage(pageIndex+1));on(elements.readerPrevChapter,'click',()=>adjacentChapter(-1));on(elements.readerNextChapter,'click',()=>adjacentChapter(1));
  on(elements.readerMode,'click',async()=>{readerMode=readerMode==='paged'?'continuous':'paged';if(readerMode==='continuous')renderContinuous();else{elements.readerContinuous.hidden=true;showPage(pageIndex)};await db.request('/api/account/preferences',{method:'PUT',body:JSON.stringify({catalogView:elements.grid.dataset.layout||'grid',readerMode})});});on(elements.zoomIn,'click',()=>setZoom(zoom+.2));on(elements.zoomOut,'click',()=>setZoom(zoom-.2));on(elements.zoomReset,'click',()=>{setZoom(1);elements.readerStage.scrollTo({top:0,left:0,behavior:reducedMotion?'instant':'smooth'})});
  on(elements.readerStage,'click',event=>{if(zoom>1.01||readerMode!=='paged'||event.target!==elements.readerStage&&event.target!==elements.readerImage)return;const x=event.clientX/innerWidth;if(x<.3)showPage(pageIndex-1);else if(x>.7)showPage(pageIndex+1)});
  on(elements.readerStage,'touchstart',event=>{if(event.touches.length===2){const [a,b]=event.touches;pinchStart={distance:Math.hypot(a.clientX-b.clientX,a.clientY-b.clientY),zoom};touchStart=null;panStart=null;return;}if(event.touches.length===1){const touch=event.touches[0];touchStart=touch.clientX;if(zoom>1.01)panStart={x:touch.clientX,y:touch.clientY,left:elements.readerStage.scrollLeft,top:elements.readerStage.scrollTop};}},{passive:true});
  on(elements.readerStage,'touchmove',event=>{if(event.touches.length===2&&pinchStart){event.preventDefault();const [a,b]=event.touches;setZoom(pinchStart.zoom*Math.hypot(a.clientX-b.clientX,a.clientY-b.clientY)/pinchStart.distance);return;}if(event.touches.length===1&&panStart){event.preventDefault();const touch=event.touches[0];elements.readerStage.scrollLeft=panStart.left-(touch.clientX-panStart.x);elements.readerStage.scrollTop=panStart.top-(touch.clientY-panStart.y);touchStart=null;}},{passive:false});
  on(elements.readerStage,'touchend',event=>{if(pinchStart||panStart){if(event.touches.length<2)pinchStart=null;if(!event.touches.length)panStart=null;touchStart=null;return;}if(touchStart==null)return;const dx=event.changedTouches[0].clientX-touchStart;touchStart=null;if(Math.abs(dx)>60)(dx<0?showPage(pageIndex+1):showPage(pageIndex-1))},{passive:true});
  on(elements.commentForm,'submit',async event=>{event.preventDefault();try{await db.request(`/api/manga/comments/${provider}/${encodeURIComponent(currentSeriesId)}/${encodeURIComponent(currentBook.id)}`,{method:'POST',body:JSON.stringify({content:elements.commentText.value.trim()})});elements.commentForm.reset();loadComments();}catch(error){elements.commentsStatus.textContent=error.message;}});
  doc.addEventListener('keydown',event=>{if(!elements.readerDialog.open)return;if(event.key==='Escape'&&expandedFallback){expandedFallback=false;syncFullscreen();return;}if(event.key==='0')setZoom(1);if(event.key==='+'||event.key==='=')setZoom(zoom+.2);if(event.key==='-')setZoom(zoom-.2);if(zoom<=1.01&&event.key==='ArrowLeft')showPage(pageIndex-1);if(zoom<=1.01&&event.key==='ArrowRight')showPage(pageIndex+1);if(event.key==='PageUp')adjacentChapter(-1);if(event.key==='PageDown')adjacentChapter(1)});
  on(window,'resize',applyZoom);
  elements.grid.dataset.layout=user.catalogView==='list'?'list':'grid';loadPlaylists().catch(()=>{});
  return { load, openBook, useProvider(value){provider=value==='komga'?'komga':'mangadex'}, loadPlaylists };
}

function createMangaDetailV2({ db, catalog, elements, notify = () => {} }) {
  let provider='',id='',series=null,state=null,allBooks=[],requestId=0,totalBooks=0,metaChapters=0,metaVolumes=0;
  const statusLabels={ongoing:'Em publicação',completed:'Completo',hiatus:'Em hiato',cancelled:'Cancelado',Publishing:'Em publicação',Finished:'Completo','On Hiatus':'Em hiato',Discontinued:'Cancelado'};
  const stateUrl=()=>`/api/manga/state/${provider}/${encodeURIComponent(id)}`;
  function normalizeBooks(books){const unique=new Map();for(const book of books)if(!unique.has(book.id))unique.set(book.id,book);return [...unique.values()].sort((a,b)=>{const av=parseFloat(a.chapter??a.number)||0,bv=parseFloat(b.chapter??b.number)||0;return av-bv||String(a.title).localeCompare(String(b.title),'pt-BR',{numeric:true})});}
  function sync(){
    if(!state)return;
    const chapters=Math.max(0,Number(state.chapters_read)||0), total=Number(metaChapters)||0;
    elements.readingStatus.value=state.reading_status;
    elements.favorite.setAttribute('aria-pressed',String(state.favorite));
    elements.favorite.querySelector('span').textContent=state.favorite?'Favoritado':'Favoritar';
    elements.viewMode.value=state.view_mode;
    elements.userProgress.textContent=`${chapters} capítulos · ${state.volumes_read} volumes`;
    if(elements.progressCurrent)elements.progressCurrent.textContent=chapters;
    if(elements.progressTotal)elements.progressTotal.textContent=total||'—';
    if(elements.progressBar){const percent=total?Math.min(100,Math.round(chapters/total*100)):0;elements.progressBar.style.setProperty('--progress',`${percent}%`);elements.progressBar.setAttribute('aria-valuemax',String(total));elements.progressBar.setAttribute('aria-valuenow',String(Math.min(chapters,total||chapters)));}
    elements.rating?.querySelectorAll('[data-rating]').forEach(b=>b.dataset.active=String(Number(b.dataset.rating)<=Number(state.rating||0)));
    elements.like?.setAttribute('aria-pressed',String(state.reaction===1));elements.dislike?.setAttribute('aria-pressed',String(state.reaction===-1));
  }
  async function save(patch){try{const result=await db.request(stateUrl(),{method:'PUT',body:JSON.stringify({...patch,title:series?.title||'',coverUrl:series?.thumbnailUrl||'',sourceUrl:series?.sourceUrl||''})});state=result.state;sync();renderSummary(result.summary);}catch(error){notify(error.message,false);}}
  function renderGenres(genres=[]){
    if(!elements.infoGenres)return;
    elements.infoGenres.replaceChildren();
    const values=(Array.isArray(genres)?genres:[]).map(value=>String(value).trim()).filter(Boolean);
    if(!values.length){const empty=document.createElement('span');empty.className='manga-genre-empty';empty.textContent='Não informado';elements.infoGenres.append(empty);return;}
    for(const value of values.slice(0,8)){const chip=document.createElement('span');chip.className='manga-genre-chip';chip.textContent=value;elements.infoGenres.append(chip);}
  }
  function renderSummary(summary={}){const count=Number(summary.ratingCount)||0;if(elements.communityScore)elements.communityScore.textContent=count?Number(summary.average||0).toFixed(1):'—';if(elements.ratingSummary)elements.ratingSummary.textContent=count?`${count} ${count===1?'avaliação':'avaliações'}`:'Sem avaliações';if(elements.like)elements.like.querySelector('span').textContent=summary.likes||0;if(elements.dislike)elements.dislike.querySelector('span').textContent=summary.dislikes||0;}
  function row(book){const node=elements.bookTemplate.content.firstElementChild.cloneNode(true),image=node.querySelector('[data-book-cover]');image.src=book.thumbnailUrl;image.onerror=()=>image.style.visibility='hidden';node.querySelector('[data-book-title]').textContent=book.title;node.querySelector('[data-book-pages]').textContent=`${book.pagesCount} páginas`;node.querySelector('[data-book-state]').textContent='Ler agora';node.onclick=()=>{catalog.useProvider(provider);catalog.openBook(book,allBooks,id)};return node;}
  function render(){elements.books.replaceChildren();if(elements.viewMode.value==='chapter'){allBooks.forEach(b=>elements.books.append(row(b)));return;}const groups=new Map();for(const b of allBooks){const v=b.volume||'Sem volume';if(!groups.has(v))groups.set(v,[]);groups.get(v).push(b);}for(const [volume,books] of groups){const section=document.createElement('section');section.className='manga-volume-group';const h=document.createElement('h4');h.textContent=volume==='Sem volume'?volume:`Volume ${volume}`;const list=document.createElement('div');list.className='manga-volume-list';books.forEach(b=>list.append(row(b)));section.append(h,list);elements.books.append(section);}}
  async function adjustProgress(delta){if(!state)return;const current=Math.max(0,Number(state.chapters_read)||0),total=Number(metaChapters)||0,next=Math.max(0,current+delta);if(total&&next>total)return;await save({chaptersRead:next});}
  elements.readingStatus.onchange=()=>save({readingStatus:elements.readingStatus.value});elements.favorite.onclick=()=>save({favorite:!state.favorite});elements.progressMinus?.addEventListener('click',()=>adjustProgress(-1));elements.progressPlus?.addEventListener('click',()=>adjustProgress(1));elements.viewMode.onchange=()=>{save({viewMode:elements.viewMode.value});render()};
  elements.editProgress.onclick=()=>{elements.progressChapters.value=state.chapters_read;elements.progressVolumes.value=state.volumes_read;elements.progressDialog.showModal()};elements.progressClose.onclick=elements.progressCancel.onclick=()=>elements.progressDialog.close();elements.progressForm.onsubmit=event=>{event.preventDefault();save({chaptersRead:Math.max(0,Math.floor(Number(elements.progressChapters.value)||0)),volumesRead:Math.max(0,Math.floor(Number(elements.progressVolumes.value)||0))});elements.progressDialog.close()};
  elements.rating?.querySelectorAll('[data-rating]').forEach(button=>button.onclick=()=>save({rating:Number(button.dataset.rating)}));if(elements.like)elements.like.onclick=()=>save({reaction:state.reaction===1?0:1});if(elements.dislike)elements.dislike.onclick=()=>save({reaction:state.reaction===-1?0:-1});if(elements.addPlaylist)elements.addPlaylist.onchange=async()=>{if(!elements.addPlaylist.value)return;try{await db.request(`/api/manga/playlists/${elements.addPlaylist.value}/items`,{method:'POST',body:JSON.stringify({provider,seriesId:id,title:series.title,coverUrl:series.thumbnailUrl,sourceUrl:series.sourceUrl||''})});notify('Mangá adicionado à lista.');elements.addPlaylist.value='';catalog.loadPlaylists();}catch(error){notify(error.message,false);}};
  async function load(p,sid,offset=0){const current=++requestId;provider=p;id=sid;catalog.useProvider(p);if(!offset){allBooks=[];elements.books.replaceChildren();elements.title.textContent='Carregando mangá…';elements.status.textContent='Buscando informações…';}
    try{if(!offset){const [detail,userState]=await Promise.all([db.request(`/api/${p}/series/${encodeURIComponent(sid)}`),db.request(stateUrl())]);if(current!==requestId)return;series=detail.series;state=userState.state;renderSummary(userState.summary);sync();let jikan=null;try{jikan=(await db.request('/api/jikan/manga?'+new URLSearchParams({q:series.title}))).manga}catch{};document.title=`${series.title} | NEXUS`;elements.title.textContent=series.title;elements.author.textContent=(series.authors?.length?series.authors:jikan?.authors||[]).join(', ')||'Autor não informado';elements.summary.textContent=series.summary||jikan?.synopsis||'Descrição não cadastrada.';elements.infoStatus.textContent=statusLabels[jikan?.status||series.status]||jikan?.status||series.status||'Não informado';metaChapters=jikan?.chapters||Number(series.booksCount)||0;metaVolumes=jikan?.volumes||0;elements.infoChapters.textContent=metaChapters||'—';elements.infoYear.textContent=jikan?.releaseYear||series.releaseYear||'Não informado';renderGenres(jikan?.genres?.length?jikan.genres:series.genres||[]);elements.dataSource.hidden=!jikan;sync();elements.cover.src=series.thumbnailUrl;elements.cover.alt=`Capa de ${series.title}`;elements.cover.onload=()=>{elements.cover.hidden=false;elements.placeholder.hidden=true};elements.cover.onerror=()=>{elements.cover.hidden=true;elements.placeholder.hidden=false};elements.source.hidden=!series.sourceUrl;if(series.sourceUrl)elements.source.href=series.sourceUrl;await catalog.loadPlaylists();}
      const result=await db.request(`/api/${p}/series/${encodeURIComponent(sid)}/books?`+new URLSearchParams({lang:'pt-br',offset}));if(current!==requestId)return;allBooks=normalizeBooks([...allBooks,...(result.books||[])]);totalBooks=result.total??allBooks.length;render();elements.count.textContent=`${totalBooks} capítulos`;elements.infoChapters.textContent=metaChapters||totalBooks;elements.progressChapters.max=metaChapters||totalBooks||'';elements.progressVolumes.max=metaVolumes||new Set(allBooks.map(b=>b.volume).filter(Boolean)).size||'';elements.status.textContent=allBooks.length?'':'Nenhum capítulo disponível em português do Brasil.';elements.more.hidden=result.nextOffset==null;elements.more.onclick=()=>load(p,sid,result.nextOffset);
    }catch(error){if(current===requestId)elements.status.textContent=error.message;}}
  return {load};
}

function createAccountSettings({ db, dialog, button, user, notify = () => {} }) {
  if(!dialog||!button)return;
  dialog.innerHTML=`<div class="account-settings-heading"><div><p class="user-eyebrow">CONTA NEXUS</p><h2>Perfil e configurações</h2></div><button id="account-close" type="button" aria-label="Fechar"><i class="ph ph-x"></i></button></div>
  <div class="account-settings-grid"><nav aria-label="Categorias"><a href="#settings-account">Conta</a><a href="#settings-appearance">Aparência</a><a href="#settings-reading">Leitura</a><a href="#settings-privacy">Privacidade</a><a href="#settings-content">Conteúdo</a><a href="#settings-feedback">Sugestões</a></nav><div class="account-settings-content">
  <section id="settings-account"><h3>Conta</h3><form id="profile-form"><div class="avatar-editor"><img id="profile-avatar-preview" alt="Prévia da foto" hidden><label>Foto de perfil<input id="profile-avatar" type="file" accept="image/png,image/jpeg,image/webp"></label></div><label>Nome de exibição<input id="profile-display-name" maxlength="80" required></label><label>Biografia<textarea id="profile-bio" maxlength="500"></textarea></label><label>Interesses, separados por vírgula<input id="profile-interests" maxlength="480"></label><button type="submit">Salvar perfil</button></form><div id="profile-stats" class="profile-stats"></div></section>
  <section id="settings-appearance"><h3>Aparência</h3><label>Visualização do catálogo<select id="setting-catalog-view"><option value="grid">Grade</option><option value="list">Lista</option></select></label></section>
  <section id="settings-reading"><h3>Leitura</h3><label>Modo padrão<select id="setting-reader-mode"><option value="paged">Uma página</option><option value="continuous">Rolagem contínua</option></select></label></section>
  <section id="settings-privacy"><h3>Privacidade</h3><label><input id="profile-public" type="checkbox"> Tornar perfil público</label><label><input id="profile-interests-public" type="checkbox"> Mostrar interesses no perfil</label><p>Faixa etária e PIN nunca aparecem no perfil público.</p></section>
  <section id="settings-content"><h3>Conteúdo</h3><div id="age-confirmation"><p>Confirme somente se esta conta pertence a uma pessoa adulta. Obras explícitas continuam ocultas até a criação do PIN.</p><button type="button" data-age="minor">Sou menor de idade</button><button type="button" data-age="adult">Sou maior de idade</button></div><form id="pin-form"><label>PIN de 4 números<input id="content-pin" inputmode="numeric" pattern="[0-9]{4}" maxlength="4" required></label><button id="pin-submit" type="submit">Ativar conteúdo adulto</button></form><button id="pin-lock" type="button">Ocultar conteúdo adulto</button><form id="pin-reset-form"><label>Senha da conta<input id="content-password" type="password" required></label><button type="submit">Redefinir PIN e bloquear conteúdo</button></form><p id="content-status" role="status"></p></section>
  <section id="settings-feedback"><h3>Sugestões e problemas</h3><form id="suggestion-form"><label>Assunto<input id="suggestion-subject" maxlength="120" required></label><label>Descrição<textarea id="suggestion-description" maxlength="2000" required></textarea></label><button type="submit">Enviar sugestão</button></form></section>
  </div></div>`;
  const $=id=>dialog.querySelector('#'+id);let profile=user,avatar='';
  function apply(data){profile=data.user;avatar=profile.avatar||'';$('profile-display-name').value=profile.displayName||profile.username;$('profile-bio').value=profile.bio||'';$('profile-interests').value=(profile.interests||[]).join(', ');$('profile-public').checked=profile.profilePublic;$('profile-interests-public').checked=profile.interestsPublic;$('setting-catalog-view').value=profile.catalogView||'grid';$('setting-reader-mode').value=profile.readerMode||'paged';$('age-confirmation').hidden=profile.ageGroup!=='unknown';$('pin-form').hidden=profile.ageGroup!=='adult';$('pin-reset-form').hidden=profile.ageGroup!=='adult';$('pin-lock').hidden=profile.ageGroup!=='adult'||!profile.explicitEnabled;$('pin-submit').textContent=profile.contentPinSet?'Desbloquear conteúdo':'Criar PIN e ativar';const image=$('profile-avatar-preview');image.hidden=!avatar;if(avatar)image.src=avatar;const s=data.stats||{};$('profile-stats').textContent=`${s.favorites||0} favoritos · ${s.playlists||0} listas · ${s.chaptersStarted||0} leituras iniciadas`;}
  async function refresh(){try{apply(await db.request('/api/account/profile'));}catch(error){notify(error.message,false);}}
  async function open(){await refresh();if(!dialog.open)dialog.showModal();}
  button.addEventListener('click',open);$('account-close').onclick=()=>dialog.close();dialog.addEventListener('click',event=>{if(event.target===dialog)dialog.close()});
  $('profile-avatar').onchange=()=>{const file=$('profile-avatar').files[0];if(!file)return;if(file.size>400*1024){notify('A foto deve ter até 400 KB.',false);$('profile-avatar').value='';return;}const reader=new FileReader();reader.onload=()=>{avatar=reader.result;const image=$('profile-avatar-preview');image.src=avatar;image.hidden=false};reader.readAsDataURL(file)};
  $('profile-form').onsubmit=async event=>{event.preventDefault();try{const data=await db.request('/api/account/profile',{method:'PUT',body:JSON.stringify({displayName:$('profile-display-name').value.trim(),bio:$('profile-bio').value.trim(),interests:$('profile-interests').value.split(',').map(v=>v.trim()).filter(Boolean),avatar,profilePublic:$('profile-public').checked,interestsPublic:$('profile-interests-public').checked})});apply(data);notify('Perfil salvo.')}catch(error){notify(error.message,false)}};
  for(const input of [$('profile-public'),$('profile-interests-public')])input.onchange=()=> $('profile-form').requestSubmit();
  for(const input of [$('setting-catalog-view'),$('setting-reader-mode')])input.onchange=async()=>{try{const data=await db.request('/api/account/preferences',{method:'PUT',body:JSON.stringify({catalogView:$('setting-catalog-view').value,readerMode:$('setting-reader-mode').value})});profile=data.user;notify('Preferências salvas.')}catch(error){notify(error.message,false)}};
  dialog.querySelectorAll('[data-age]').forEach(control=>control.onclick=async()=>{try{const data=await db.request('/api/account/age',{method:'POST',body:JSON.stringify({adult:control.dataset.age==='adult'})});apply({user:data.user,stats:(await db.request('/api/account/profile')).stats});$('content-status').textContent='Confirmação registrada.';}catch(error){$('content-status').textContent=error.message}});
  $('pin-form').onsubmit=async event=>{event.preventDefault();try{const endpoint=profile.contentPinSet?'/api/account/content-unlock':'/api/account/content-pin';const data=await db.request(endpoint,{method:'POST',body:JSON.stringify({pin:$('content-pin').value})});apply({user:data.user,stats:(await db.request('/api/account/profile')).stats});$('content-pin').value='';$('content-status').textContent='Filtro adulto ativado com PIN.';}catch(error){$('content-status').textContent=error.message}};
  $('pin-lock').onclick=async()=>{try{const data=await db.request('/api/account/content-lock',{method:'POST',body:'{}'});apply({user:data.user,stats:(await db.request('/api/account/profile')).stats});$('content-status').textContent='Conteúdo adulto ocultado.';}catch(error){$('content-status').textContent=error.message}};
  $('pin-reset-form').onsubmit=async event=>{event.preventDefault();try{const data=await db.request('/api/account/content-reset',{method:'POST',body:JSON.stringify({password:$('content-password').value})});profile=data.user;$('content-password').value='';$('content-status').textContent='Conteúdo adulto bloqueado e PIN removido.';}catch(error){$('content-status').textContent=error.message}};
  $('suggestion-form').onsubmit=async event=>{event.preventDefault();try{await db.request('/api/suggestions',{method:'POST',body:JSON.stringify({subject:$('suggestion-subject').value.trim(),description:$('suggestion-description').value.trim()})});event.target.reset();notify('Sugestão enviada.')}catch(error){notify(error.message,false)}};
  return { open, refresh };
}

function createProfilePage({ db, elements, user, notify = () => {} }) {
  if(!elements.view)return { load: async()=>{} };
  let profile={...user},avatar=profile.avatar||'',saving=false;
  function setImage(image,placeholder,url){image.hidden=!url;if(placeholder)placeholder.hidden=Boolean(url);if(url)image.src=url;else image.removeAttribute('src');}
  function fillForm(){elements.displayName.value=profile.displayName||profile.username;elements.bioInput.value=profile.bio||'';avatar=profile.avatar||'';setImage(elements.preview,elements.previewPlaceholder,avatar);elements.file.value='';elements.saveStatus.textContent='';}
  function render(data){profile=data.user;const stats=data.stats||{};elements.name.textContent=profile.displayName||profile.username;elements.username.textContent=`@${profile.username}`;elements.bio.textContent=profile.bio||'Nenhuma biografia cadastrada.';elements.created.textContent=profile.createdAt?`Membro desde ${new Date(profile.createdAt+'Z').toLocaleDateString('pt-BR',{month:'long',year:'numeric'})}`:'Data de cadastro indisponível';elements.favoriteStat.textContent=stats.favorites||0;elements.playlistStat.textContent=stats.playlists||0;elements.readingStat.textContent=stats.chaptersStarted||0;setImage(elements.avatar,elements.avatarPlaceholder,profile.avatar);if(elements.topName)elements.topName.textContent=profile.displayName||profile.username;fillForm();}
  function renderFavorites(items){elements.favoritesGrid.replaceChildren();elements.favoritesEmpty.hidden=Boolean(items.length);for(const raw of items){const card=document.createElement('a');card.className='profile-favorite-card';card.href=`/mangas/${raw.provider}/${encodeURIComponent(raw.series_id)}`;const image=document.createElement('img');image.alt=`Capa de ${raw.title}`;image.loading='lazy';image.src=raw.cover_url;image.onerror=()=>{image.hidden=true;card.classList.add('without-image')};const copy=document.createElement('span');const title=document.createElement('strong');title.textContent=raw.title;const status=document.createElement('small');status.textContent=raw.reading_status==='reading'?'Lendo':raw.reading_status==='completed'?'Completo':'Na biblioteca';copy.append(title,status);card.append(image,copy);elements.favoritesGrid.append(card);}}
  async function load(){elements.saveStatus.textContent='Carregando perfil…';try{const [data,favorites]=await Promise.all([db.request('/api/account/profile'),db.request('/api/manga/favorites')]);render(data);renderFavorites(favorites.items);elements.saveStatus.textContent='';}catch(error){elements.saveStatus.textContent=error.message;}}
  elements.edit.onclick=()=>{fillForm();elements.form.hidden=false;elements.edit.disabled=true;elements.displayName.focus()};elements.cancel.onclick=()=>{elements.form.hidden=true;elements.edit.disabled=false;fillForm()};
  elements.settings.onclick=()=>elements.openSettings?.();
  elements.file.onchange=()=>{const file=elements.file.files[0];if(!file)return;if(!['image/png','image/jpeg','image/webp'].includes(file.type)){elements.saveStatus.textContent='Escolha uma imagem PNG, JPG ou WebP.';elements.file.value='';return;}if(file.size>400*1024){elements.saveStatus.textContent='A foto deve ter até 400 KB.';elements.file.value='';return;}const reader=new FileReader();reader.onload=()=>{avatar=String(reader.result);setImage(elements.preview,elements.previewPlaceholder,avatar);elements.saveStatus.textContent=''};reader.onerror=()=>elements.saveStatus.textContent='Não foi possível ler a imagem.';reader.readAsDataURL(file)};
  elements.form.onsubmit=async event=>{event.preventDefault();if(saving)return;const displayName=elements.displayName.value.trim(),bio=elements.bioInput.value.trim();if(!displayName||displayName.length>80){elements.saveStatus.textContent='O nome deve ter entre 1 e 80 caracteres.';return;}if(bio.length>500){elements.saveStatus.textContent='A biografia deve ter até 500 caracteres.';return;}saving=true;elements.save.disabled=true;const original=elements.save.innerHTML;elements.save.textContent='Salvando…';elements.saveStatus.textContent='Salvando alterações…';try{const data=await db.request('/api/account/profile',{method:'PUT',body:JSON.stringify({displayName,bio,interests:profile.interests||[],avatar,profilePublic:Boolean(profile.profilePublic),interestsPublic:Boolean(profile.interestsPublic)})});render(data);elements.form.hidden=true;elements.edit.disabled=false;elements.saveStatus.textContent='Perfil salvo com sucesso.';notify('Perfil atualizado.');}catch(error){elements.saveStatus.textContent=error.message;notify(error.message,false);}finally{saving=false;elements.save.disabled=false;elements.save.innerHTML=original;}};
  return {load};
}

// Cada página inicializa somente seus próprios controles.
async function initializeApp() {
  const db = new ApiDB();
  const $ = id => document.getElementById(id);
  const loginForm = $('login-form');
  const currentUser = await db.getSession();
  const destination = user => user?.role === 'admin' ? '/admin' : '/filmes';

  if (loginForm) {
    if (currentUser) { location.replace(destination(currentUser)); return; }
    $('show-password').onchange = event => { $('login-password').type = event.target.checked ? 'text' : 'password'; };
    loginForm.onsubmit = event => {
      event.preventDefault();
      const button = $('login-submit');
      if (button.disabled) return;
      button.disabled = true;
      button.textContent = 'Autenticando...';
      $('login-error').textContent = '';
      setTimeout(async () => {
        const [success, result] = await db.authenticate($('login-user').value.trim(), $('login-password').value.trim());
        button.disabled = false;
        button.textContent = 'Entrar';
        if (!success) { $('login-error').textContent = result; return; }
        location.replace(destination(result));
      }, 800);
    };
    $('login-user').focus();
    return;
  }

  if (!currentUser) { location.replace('/login'); return; }
  const page = document.body.dataset.page;
  if (page === 'admin' && currentUser.role !== 'admin') { location.replace('/filmes'); return; }
  if (page === 'user' && currentUser.role === 'admin') { location.replace('/admin'); return; }
  if (!['admin', 'user'].includes(page)) { location.replace(destination(currentUser)); return; }

  window.addEventListener('pageshow', event => { if (event.persisted) location.reload(); });
  function notify(message, success = true) {
    const node = $('toast-template').content.firstElementChild.cloneNode(true);
    node.textContent = message;
    node.dataset.error = String(!success);
    $('notifications').append(node);
    setTimeout(() => node.remove(), 3000);
  }
  async function logout(stop = () => {}) {
    stop();
    try { await db.logout(); location.replace('/login'); }
    catch (error) { notify(error.message, false); }
  }

  if (page === 'admin') {
    const userForm = $('user-form');
    const dialog = $('user-dialog');
    const search = $('admin-user-search');
    const planFilter = $('admin-plan-filter');
    const statusFilter = $('admin-status-filter');
    let editingUsername = null;
    let users = new Map();
    $('admin-name').textContent = currentUser.username;

    function filteredUsers() {
      const query = search.value.trim().toLocaleLowerCase('pt-BR');
      return [...users].filter(([username, data]) =>
        (!query || username.toLocaleLowerCase('pt-BR').includes(query)) &&
        (!planFilter.value || data.plan === planFilter.value) &&
        (!statusFilter.value || data.status === statusFilter.value));
    }
    function updateSummary() {
      const list = [...users.values()];
      const active = list.filter(user => user.status === 'Ativo').length;
      $('stat-total').textContent = list.length;
      $('stat-active').textContent = active;
      $('stat-premium').textContent = list.filter(user => user.plan === 'Premium').length;
      $('stat-inactive').textContent = list.length - active;
      $('stat-active-rate').textContent = (list.length ? Math.round(active / list.length * 100) : 0) + '% do total';
      $('admin-updated').textContent = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' }).format(new Date());
    }
    function renderUsers() {
      const list = filteredUsers();
      const body = $('users-body');
      body.replaceChildren();
      $('empty-users').hidden = list.length !== 0;
      $('user-result-count').textContent = list.length + (list.length === 1 ? ' resultado' : ' resultados');
      for (const [username, data] of list) {
        const row = $('user-row-template').content.firstElementChild.cloneNode(true);
        const field = name => row.querySelector('[data-field="' + name + '"]');
        field('avatar').textContent = username.slice(0, 2).toUpperCase();
        field('username').textContent = username;
        field('password').textContent = '••••••••';
        field('plan').textContent = data.plan;
        field('plan').dataset.premium = String(data.plan === 'Premium');
        field('status').textContent = data.status;
        field('status').dataset.active = String(data.status === 'Ativo');
        row.querySelector('[data-action="edit"]').onclick = () => openUserDialog(username, data);
        row.querySelector('[data-action="delete"]').onclick = async event => {
          const button = event.currentTarget;
          button.disabled = true;
          const [success, message] = await db.deleteUser(username);
          if (success) await populateUsers(); else button.disabled = false;
          notify(message, success);
        };
        body.append(row);
      }
    }
    async function populateUsers() {
      try { users = await db.getAllUsers(); }
      catch (error) { notify(error.message, false); return; }
      updateSummary();
      renderUsers();
    }
    function openUserDialog(username = null, data = null) {
      editingUsername = username;
      userForm.reset();
      $('dialog-title').textContent = username === null ? 'Criar novo usuário' : 'Editar usuário';
      $('edit-user').value = username ?? '';
      $('edit-password').value = '';
      $('edit-password').required = username === null;
      $('edit-password').placeholder = username === null ? 'Crie uma senha' : 'Deixe vazio para manter';
      $('edit-plan').value = data?.plan ?? 'Basic';
      $('edit-status').value = data?.status ?? 'Ativo';
      $('user-error').textContent = '';
      dialog.showModal();
    }
    userForm.onsubmit = async event => {
      event.preventDefault();
      const username = $('edit-user').value.trim();
      const password = $('edit-password').value.trim();
      if (!username || (editingUsername === null && !password)) { $('user-error').textContent = 'Preencha usuário e senha.'; return; }
      const args = [username, password, $('edit-plan').value, $('edit-status').value];
      const submit = userForm.querySelector('[type="submit"]');
      if (submit.disabled) return;
      submit.disabled = true;
      const [success, message] = editingUsername === null ? await db.addUser(...args) : await db.updateUser(editingUsername, ...args);
      submit.disabled = false;
      if (!success) { $('user-error').textContent = message; return; }
      await populateUsers();
      dialog.close();
      notify(message);
    };
    search.addEventListener('input', renderUsers);
    planFilter.addEventListener('change', renderUsers);
    statusFilter.addEventListener('change', renderUsers);
    $('cancel-user').onclick = () => dialog.close();
    $('add-user').onclick = () => openUserDialog();
    async function populateSuggestions() {
      const target=$('admin-suggestions');
      try { const data=await db.request('/api/admin/suggestions');target.replaceChildren();if(!data.suggestions.length){target.textContent='Nenhuma sugestão recebida.';return;}for(const item of data.suggestions){const article=document.createElement('article');article.className='admin-suggestion';const header=document.createElement('header');const title=document.createElement('strong');title.textContent=item.subject;const meta=document.createElement('span');meta.textContent=`${item.username} · ${new Date(item.created_at+'Z').toLocaleString('pt-BR')}`;const text=document.createElement('p');text.textContent=item.description;header.append(title,meta);article.append(header,text);target.append(article);}} catch(error){target.textContent=error.message;}
    }
    $('refresh-suggestions').onclick=populateSuggestions;
    document.querySelectorAll('[data-logout]').forEach(button => { button.onclick = () => logout(); });
    await Promise.all([populateUsers(),populateSuggestions()]);
    return;
  }

  const username = currentUser.username;
  let onlineCatalog, mangaCatalog;
  function switchTab(name) {
    if (name === 'music') { metadataCatalog.load(); onlineCatalog?.load(); }
    if (name === 'mangas') mangaCatalog?.load();
    libraryCatalog?.setLastTab(name);
    document.querySelectorAll('[data-view]').forEach(view => { view.hidden = view.dataset.view !== name; });
    const active = name === 'manga-detail' ? 'mangas' : name;
    document.querySelectorAll('[data-nav]').forEach(link => {
      if (link.dataset.nav === active) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    });
  }
  let libraryCatalog;
  const player = createAudioPlayer({
    audio: $('vmz'), playButton: $('player-toggle'), progress: $('player-progress'),
    previousButton: $('voltar'), nextButton: $('player-next'), muteButton: $('player-mute'),
    shuffleButton: $('player-shuffle'), repeatButton: $('player-repeat'),
    currentTime: $('player-current-time'), totalTime: $('player-total-time'),
    volume: $('player-volume'), trackButtons: document.querySelectorAll('[data-track]'),
    title: $('song-title'), artist: $('song-artist'), durationLabels: [...document.querySelectorAll('[data-duration]')], notify,
    onTrackChange: () => { metadataCatalog.syncPlayer(); libraryCatalog?.recordRecent(); }
  });
  const metadataCatalog = createMetadataCatalog({
    db, buttons: document.querySelectorAll('[data-track]'), player,
    cover: $('song-cover'), sourceLinks: $('song-sources'), statusLabel: $('metadata-status'), document
  });
  onlineCatalog = createOnlineCatalog({
    db, search: $('music-search'), template: $('online-track-template'),
    discover: { section: $('online-catalog'), title: $('online-title'), status: $('online-status'), list: $('online-tracks') },
    results: { section: $('spotify-search-results'), title: $('spotify-search-title'), status: $('spotify-search-status'), list: $('spotify-search-list') },
    collectionTitle: $('music-collection-title'), collectionCount: $('music-collection-count')
  });
  mangaCatalog = createMangaExperience({
    db, document, user: currentUser, notify, elements: {
      provider: $('manga-provider'), language: $('manga-language'), previous: $('manga-previous'), next: $('manga-next'), page: $('manga-page'), moreBooks: $('manga-more-books'), source: $('manga-source'),
      search: $('manga-search'), refresh: $('manga-refresh'), connection: $('komga-connection'), count: $('manga-count'),
      setup: $('komga-setup'), setupMessage: $('komga-setup-message'), grid: $('manga-grid'), empty: $('manga-empty'), status: $('manga-status'),
      seriesTemplate: $('manga-series-template'), bookTemplate: $('manga-book-template'), seriesDialog: $('manga-series-dialog'),
      seriesClose: $('manga-series-close'), seriesCover: $('manga-series-cover'), seriesTitle: $('manga-series-title'),
      seriesAuthor: $('manga-series-author'), seriesSummary: $('manga-series-summary'), books: $('manga-books'),
      booksCount: $('manga-books-count'), booksStatus: $('manga-books-status'), readerDialog: $('manga-reader-dialog'),
      readerClose: $('manga-reader-close'), readerFullscreen: $('manga-reader-fullscreen'), readerTitle: $('manga-reader-title'),
      readerCounter: $('manga-reader-counter'), readerStage: $('manga-reader-stage'), readerImage: $('manga-reader-image'),
      readerStatus: $('manga-reader-status'), readerPrevious: $('manga-reader-prev'), readerNext: $('manga-reader-next'),
      showCatalog: $('manga-show-catalog'), showFavorites: $('manga-show-favorites'), showPlaylists: $('manga-show-playlists'), viewToggle: $('manga-view-toggle'),
      hero: $('manga-hero'), heroTrack: $('manga-hero-track'), heroPrevious: $('manga-hero-previous'), heroNext: $('manga-hero-next'), heroDots: $('manga-hero-dots'), heroStatus: $('manga-hero-status'),
      playlistsDialog: $('manga-playlists-dialog'), playlistsClose: $('manga-playlists-close'), playlistForm: $('manga-playlist-form'), playlistName: $('manga-playlist-name'), playlistStatus: $('manga-playlist-status'), playlistsList: $('manga-playlists-list'), addPlaylist: $('manga-add-playlist'),
      readerPrevChapter: $('manga-reader-prev-chapter'), readerNextChapter: $('manga-reader-next-chapter'), readerMode: $('manga-reader-mode'), zoomIn: $('manga-reader-zoom-in'), zoomOut: $('manga-reader-zoom-out'), zoomReset: $('manga-reader-zoom-reset'), readerContinuous: $('manga-reader-continuous'),
      commentForm: $('manga-comment-form'), commentText: $('manga-comment-text'), commentsStatus: $('manga-comments-status'), commentsList: $('manga-comments-list')
    }
  });
  const mangaDetail = createMangaDetailV2({
    db, notify,
    catalog: mangaCatalog,
    elements: {
      cover: $('manga-detail-cover'), placeholder: $('manga-detail-placeholder'), title: $('manga-detail-title'),
      author: $('manga-detail-author'), summary: $('manga-detail-summary'),
      infoStatus: $('manga-info-status'), infoGenres: $('manga-info-genres'), infoChapters: $('manga-info-chapters'), infoYear: $('manga-info-year'),
      dataSource: $('manga-data-source'),
      source: $('manga-detail-source'), count: $('manga-detail-books-count'), books: $('manga-detail-books'),
      status: $('manga-detail-status'), more: $('manga-detail-more'), bookTemplate: $('manga-book-template'), viewMode: $('manga-view-mode'),
      readingStatus: $('manga-reading-status'), favorite: $('manga-favorite'), editProgress: $('manga-edit-progress'), userProgress: $('manga-user-progress'), progressMinus: $('manga-progress-minus'), progressPlus: $('manga-progress-plus'), progressCurrent: $('manga-progress-chapters-current'), progressTotal: $('manga-progress-chapters-total'), progressBar: $('manga-progress-bar'),
      progressDialog: $('manga-progress-dialog'), progressForm: $('manga-progress-form'), progressClose: $('manga-progress-close'),
      progressCancel: $('manga-progress-cancel'), progressChapters: $('manga-progress-chapters'), progressVolumes: $('manga-progress-volumes'),
      rating: $('manga-rating'), ratingSummary: $('manga-rating-summary'), communityScore: $('manga-community-score'), like: $('manga-like'), dislike: $('manga-dislike'), addPlaylist: $('manga-add-playlist')
    }
  });
  libraryCatalog = createLibraryFeatures({
    username, user: currentUser, buttons: document.querySelectorAll('[data-track]'),
    rows: document.querySelectorAll('[data-music-row]'), allMusicItems: document.querySelectorAll('[data-music-item]'),
    movieCards: document.querySelectorAll('[data-movie-card]'), player, switchTab, notify, document,
    elements: {
      globalSearch: $('global-search'), movieSearch: $('movie-search'), musicSearch: $('music-search'),
      movieEmpty: $('movies-empty'), musicEmpty: $('music-empty'), searchResults: $('search-results'), searchEmpty: $('search-empty'),
      searchTemplate: $('search-result-template'), collectionTitle: $('music-collection-title'), collectionCount: $('music-collection-count'),
      libraryButtons: [...document.querySelectorAll('[data-library]')], tasteButtons: [...document.querySelectorAll('[data-taste]')],
      playlists: $('playlist-list'), emptyPlaylists: $('empty-playlists'), playlistTemplate: $('playlist-item-template'), newPlaylist: $('new-playlist'),
      playlistDialog: $('playlist-dialog'), playlistForm: $('playlist-form'), playlistName: $('playlist-name'), playlistError: $('playlist-error'), cancelPlaylist: $('cancel-playlist'),
      profileButton: $('profile-button'), profileDialog: $('profile-dialog'), closeProfile: $('close-profile'),
      profileName: $('profile-name'), profileRole: $('profile-role'), profilePlan: $('profile-plan-detail'), compact: $('setting-compact'), showSources: $('setting-sources')
    }
  });
  const accountSettings=createAccountSettings({ db, dialog: $('profile-dialog'), button: $('profile-button'), user: currentUser, notify });
  const profilePage=createProfilePage({db,user:currentUser,notify,elements:{
    view:$('profile-view'),avatar:$('profile-page-avatar'),avatarPlaceholder:$('profile-page-avatar-placeholder'),name:$('profile-page-name'),username:$('profile-page-username'),bio:$('profile-page-bio'),created:$('profile-page-created'),edit:$('profile-page-edit'),settings:$('profile-page-settings'),form:$('profile-page-form'),cancel:$('profile-page-cancel'),preview:$('profile-page-preview'),previewPlaceholder:null,file:$('profile-page-file'),displayName:$('profile-page-display-name'),bioInput:$('profile-page-edit-bio'),saveStatus:$('profile-page-save-status'),save:$('profile-page-save'),favoriteStat:$('profile-stat-favorites'),playlistStat:$('profile-stat-playlists'),readingStat:$('profile-stat-reading'),favoritesGrid:$('profile-favorites-grid'),favoritesEmpty:$('profile-favorites-empty'),topName:$('user-top-name'),openSettings:()=>accountSettings?.open()
  }});
  $('profile-button').addEventListener('click',event=>{event.preventDefault();event.stopImmediatePropagation();if(location.pathname!=='/perfil')location.assign('/perfil');},{capture:true});
  createVideoViewer({
    button: $('player-fullscreen'), dialog: $('video-dialog'), stage: $('video-stage'), video: $('music-video'),
    closeButton: $('video-close'), heading: $('video-title'), errorLabel: $('video-error'), audio: $('vmz'),
    volume: $('player-volume'), player, notify, document
  });
  document.querySelectorAll('[data-logout]').forEach(button => { button.onclick = () => logout(player.stop); });
  $('user-top-name').textContent = currentUser.displayName || username;
  $('user-top-plan').textContent = 'Plano ' + currentUser.plan;
  const mangaRoute = location.pathname.match(/^\/mangas\/(komga|mangadex)\/([^/]+)$/);
  if (mangaRoute) {
    let mangaId;
    try { mangaId = decodeURIComponent(mangaRoute[2]); }
    catch { location.replace('/mangas'); return; }
    switchTab('manga-detail');
    mangaDetail.load(mangaRoute[1], mangaId);
  } else if (location.pathname === '/perfil') {
    document.title = 'Meu perfil | NEXUS';
    switchTab('profile');
    profilePage.load();
  } else if (location.pathname === '/mangas') {
    document.title = 'Mangás | NEXUS';
    switchTab('mangas');
  } else if (location.pathname === '/musicas') {
    document.title = 'Músicas | NEXUS';
    switchTab('music');
  } else {
    document.title = 'Filmes e séries | NEXUS';
    switchTab('movies');
  }
}

function startApp() {
  initializeApp().catch(error => {
    const loginError = document.getElementById('login-error');
    if (loginError) { loginError.textContent = error.message; return; }
    const template = document.getElementById('toast-template');
    const target = document.getElementById('notifications');
    if (template && target) {
      const node = template.content.firstElementChild.cloneNode(true);
      node.textContent = error.message;
      node.dataset.error = 'true';
      target.append(node);
    }
  });
}
if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', startApp, { once: true });
  else startApp();
}
if (typeof module !== 'undefined' && module.exports) module.exports = { ApiDB, createAudioPlayer, createVideoViewer, createMetadataCatalog, createOnlineCatalog, createMangaCatalog: createMangaExperience, createMangaDetail: createMangaDetailV2, createLibraryFeatures, recentMangaItems, clampReaderZoom, isReaderExpanded };
