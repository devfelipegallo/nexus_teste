'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createServer } = require('../server');

test('páginas carregam apenas seu CSS e todas as folhas locais são servidas', async t => {
  const server = createServer({ databasePath: ':memory:', databaseOptions: {
    env: { NEXUS_ADMIN_PASSWORD: 'test-password' }, logger: { warn() {} }
  } });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const base = `http://127.0.0.1:${server.address().port}`;
  const checked = new Set();
  for (const [route, own, excluded] of [
    ['/filmes', 'filmes', ['musicas', 'mangas', 'perfil', 'components/sidebar']],
    ['/musicas', 'musicas', ['filmes', 'mangas', 'perfil']],
    ['/mangas', 'mangas', ['filmes', 'musicas', 'components/sidebar']]
  ]) {
    const html = await (await fetch(base + route)).text();
    const sheets = [...html.matchAll(/href="(\/styles\/[^\"]+\.css)"/g)].map(match => match[1]);
    assert.equal(sheets[0], '/styles/global.css');
    assert.ok(sheets.includes(`/styles/${own}.css`));
    assert.equal(new Set(sheets).size, sheets.length);
    for (const name of excluded) assert.ok(!sheets.includes(`/styles/${name}.css`));
    for (const sheet of sheets) {
      if (checked.has(sheet)) continue;
      checked.add(sheet);
      const response = await fetch(base + sheet);
      assert.equal(response.status, 200, sheet);
      assert.match(response.headers.get('content-type'), /text\/css/);
      assert.ok((await response.text()).length > 0);
    }
  }
});
