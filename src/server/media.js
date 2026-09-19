"use strict";

const fs = require('node:fs/promises');
const path = require('node:path');

// Serve somente os tipos de mídia permitidos, diretamente dentro da pasta indicada.
async function serveAudio(request, response, pathname, directory, { prefix = '/assets/songs/', types = { '.mp3': 'audio/mpeg' }, download = false } = {}) {
  let handle;
  try {
    let filename;
    try { filename = decodeURIComponent(pathname.slice(prefix.length)); }
    catch { response.writeHead(400); response.end(); return; }
    if (!filename || /[\\/:\0]/.test(filename) || !Object.hasOwn(types, path.extname(filename).toLowerCase())) {
      response.writeHead(404); response.end(); return;
    }
    const root = await fs.realpath(directory);
    const filepath = await fs.realpath(path.join(root, filename));
    if (path.dirname(filepath) !== root) { response.writeHead(404); response.end(); return; }
    handle = await fs.open(filepath, 'r');
    const stat = await handle.stat();
    if (!stat.isFile()) { response.writeHead(404); response.end(); return; }
    const size = stat.size;
    const headers = {
      'Content-Type': types[path.extname(filename).toLowerCase()],
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'no-cache',
      'Content-Length': size
    };
    if (download) {
      const fallback = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
      headers['Content-Disposition'] = `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
    }
    let start = 0;
    let end = size - 1;
    let status = 200;
    // HEAD devolve os metadados completos. GET permite baixar trechos do áudio.
    const range = request.method === 'GET' && !request.headers['if-range'] ? request.headers.range : null;
    if (range) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(range);
      // Intervalos múltiplos ou desconhecidos são ignorados: resposta completa.
      if (match) {
        if (match[1]) {
          start = Number(match[1]);
          end = match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
        } else {
          const suffix = Number(match[2]);
          start = Math.max(size - suffix, 0);
        }
        if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start >= size || start > end || (!match[1] && !Number(match[2]))) {
          response.writeHead(416, { 'Content-Range': `bytes */${size}`, 'Accept-Ranges': 'bytes' });
          response.end();
          return;
        }
        status = 206;
        headers['Content-Range'] = `bytes ${start}-${end}/${size}`;
        headers['Content-Length'] = end - start + 1;
      }
    }
    response.writeHead(status, headers);
    if (request.method === 'HEAD' || size === 0) { response.end(); return; }
    const stream = handle.createReadStream({ start, end });
    handle = null; // O stream fecha o descritor, inclusive se o navegador cancelar.
    response.once('close', () => stream.destroy());
    stream.once('error', error => response.destroy(error));
    stream.pipe(response);
  } catch (error) {
    if (!response.headersSent) {
      const status = ['ENOENT', 'ENOTDIR'].includes(error.code) ? 404 : 500;
      response.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end(request.method === 'HEAD' ? undefined : 'Não foi possível carregar o áudio.');
    } else response.destroy(error);
  } finally {
    if (handle) await handle.close();
  }
}

module.exports = { serveAudio };
