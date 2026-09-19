'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const detailPages = ['mangas', 'filmes', 'musicas', 'painel'];

test('páginas de detalhe usam a estrutura editorial compartilhada', () => {
  for (const page of detailPages) {
    const html = fs.readFileSync(path.join(root, 'src', 'pages', `${page}.html`), 'utf8');
    assert.equal((html.match(/id="manga-detail-view"/g) || []).length, 1, page);
    for (const id of [
      'manga-info-genres',
      'manga-reading-status',
      'manga-progress-minus',
      'manga-progress-plus',
      'manga-progress-bar',
      'manga-community-score',
      'manga-rating',
      'manga-add-playlist'
    ]) {
      assert.match(html, new RegExp(`id="${id}"`), `${page}: ${id}`);
    }
    assert.match(html, /DETALHES DA OBRA/);
    assert.match(html, /MINHA LEITURA/);
    assert.match(html, /AVALIAÇÃO DA COMUNIDADE/);
  }
});
