'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { recentMangaItems, clampReaderZoom, isReaderExpanded } = require('../src/main');

test('carrossel usa data de adição e limita os destaques', () => {
  const items=[
    {id:'atualizado',addedAt:'2024-01-01',updatedAt:'2026-12-01'},
    {id:'novo',addedAt:'2026-01-01',updatedAt:'2026-01-01'},
    {id:'meio',addedAt:'2025-01-01',updatedAt:'2025-01-01'}
  ];
  assert.deepEqual(recentMangaItems(items,2).map(item=>item.id),['novo','meio']);
});

test('zoom do leitor respeita os limites e restaura 100%', () => {
  assert.equal(clampReaderZoom(.1),.6);
  assert.equal(clampReaderZoom(8),3);
  assert.equal(clampReaderZoom(1),1);
  assert.equal(clampReaderZoom(1.237),1.24);
});

test('tela cheia acompanha o navegador e o modo expandido alternativo', () => {
  const dialog = {};
  assert.equal(isReaderExpanded(dialog, dialog, false), true);
  assert.equal(isReaderExpanded(null, dialog, true), true);
  assert.equal(isReaderExpanded(null, dialog, false), false);
});
