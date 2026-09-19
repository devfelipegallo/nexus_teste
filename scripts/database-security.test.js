'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { openDatabase, verifyPassword } = require('../src/server/database');

test('banco novo cria somente administrador com senha configurada', () => {
  const db=openDatabase(':memory:',{env:{NEXUS_ADMIN_PASSWORD:'uma-senha-forte'},logger:{warn(){}}});
  assert.equal(verifyPassword('uma-senha-forte',db.getByUsername('admin').password_hash),true);
  assert.equal(db.getByUsername('user'),undefined);
  assert.equal(db.getByUsername('visitante'),undefined);
  db.close();
});

test('seed de demonstração só é criado quando habilitado', () => {
  const db=openDatabase(':memory:',{env:{NEXUS_ADMIN_PASSWORD:'admin-de-teste',NEXUS_SEED_DEMO:'1'},logger:{warn(){}}});
  assert.equal(verifyPassword('123',db.getByUsername('user').password_hash),true);
  assert.equal(verifyPassword('abc',db.getByUsername('visitante').password_hash),true);
  db.close();
});
