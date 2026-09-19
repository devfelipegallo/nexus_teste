"use strict";

const http = require("node:http");
const fs = require("node:fs/promises");
const path = require("node:path");
try { process.loadEnvFile(path.join(__dirname, '.env')); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
const { createApi } = require("./src/server/api");
const { serveAudio } = require("./src/server/media");

// Lista explícita: somente os arquivos da interface podem ser servidos.
const routes = new Map([
  ["/", ["src/pages/index.html", "text/html; charset=utf-8"]],
  ["/index.html", ["src/pages/index.html", "text/html; charset=utf-8"]],
  ["/login", ["src/pages/index.html", "text/html; charset=utf-8"]],
  ["/login.html", ["src/pages/index.html", "text/html; charset=utf-8"]],
  ["/painel", ["src/pages/filmes.html", "text/html; charset=utf-8"]],
  ["/painel.html", ["src/pages/filmes.html", "text/html; charset=utf-8"]],
  ["/filmes", ["src/pages/filmes.html", "text/html; charset=utf-8"]],
  ["/musicas", ["src/pages/musicas.html", "text/html; charset=utf-8"]],
  ["/mangas", ["src/pages/mangas.html", "text/html; charset=utf-8"]],
  ["/perfil", ["src/pages/mangas.html", "text/html; charset=utf-8"]],
  ["/admin", ["src/pages/admin.html", "text/html; charset=utf-8"]],
  ["/admin.html", ["src/pages/admin.html", "text/html; charset=utf-8"]],
  ["/main.js", ["src/main.js", "text/javascript; charset=utf-8"]],
  ["/assets/images/fundo.png", ["src/assets/images/fundo.png", "image/png"]],
  ["/styles.css", ["src/styles/index.css", "text/css; charset=utf-8"]],
  ["/styles/index.css", ["src/styles/index.css", "text/css; charset=utf-8"]],
  ["/styles/admin.css", ["src/styles/admin.css", "text/css; charset=utf-8"]],
  ["/styles/global.css", ["src/styles/global.css", "text/css; charset=utf-8"]],
  ["/styles/components/layout.css", ["src/styles/components/layout.css", "text/css; charset=utf-8"]],
  ["/styles/components/header.css", ["src/styles/components/header.css", "text/css; charset=utf-8"]],
  ["/styles/components/sidebar.css", ["src/styles/components/sidebar.css", "text/css; charset=utf-8"]],
  ["/styles/components/controls.css", ["src/styles/components/controls.css", "text/css; charset=utf-8"]],
  ["/styles/filmes.css", ["src/styles/filmes.css", "text/css; charset=utf-8"]],
  ["/styles/mangas.css", ["src/styles/mangas.css", "text/css; charset=utf-8"]],
  ["/styles/components/account.css", ["src/styles/components/account.css", "text/css; charset=utf-8"]],
  ["/styles/musicas.css", ["src/styles/musicas.css", "text/css; charset=utf-8"]],
  ["/styles/components/dialogs.css", ["src/styles/components/dialogs.css", "text/css; charset=utf-8"]],
  ["/styles/perfil.css", ["src/styles/perfil.css", "text/css; charset=utf-8"]],
]);

function createServer(options = {}) {
  const api = createApi(options);
  const server = http.createServer(async (request, response) => {
    response.setHeader("X-Content-Type-Options", "nosniff");
    let pathname;
    try {
      pathname = new URL(request.url, "http://localhost").pathname;
    } catch {
      response.writeHead(400);
      response.end("Endereço inválido.");
      return;
    }
    if (pathname.startsWith('/api/')) {
      await api.handle(request, response, pathname);
      return;
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.writeHead(405, { Allow: 'GET, HEAD' });
      response.end('Método não permitido.');
      return;
    }
    if (pathname.startsWith('/assets/videos/')) {
      await serveAudio(request, response, pathname, path.join(__dirname, 'src/assets/videos'), {
        prefix: '/assets/videos/', types: { '.webm': 'video/webm', '.mp4': 'video/mp4' }
      });
      return;
    }
    if (pathname.startsWith('/assets/songs/')) {
      const download = new URL(request.url, 'http://localhost').searchParams.get('download') === '1';
      await serveAudio(request, response, pathname, path.join(__dirname, 'src/assets/songs'), { download });
      return;
    }
    const route = /^\/mangas\/(komga|mangadex)\/[^/]+$/.test(pathname)
      ? ["src/pages/mangas.html", "text/html; charset=utf-8"]
      : routes.get(pathname);
    if (!route) {
      response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      response.end(request.method === "HEAD" ? undefined : "Página não encontrada.");
      return;
    }
    try {
      const content = await fs.readFile(path.join(__dirname, route[0]));
      response.writeHead(200, {
        "Content-Type": route[1],
        "Content-Length": content.length,
        "Cache-Control": "no-store"
      });
      response.end(request.method === "HEAD" ? undefined : content);
    } catch (error) {
      console.error("Não foi possível carregar o arquivo:", error.message);
      response.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
      response.end(request.method === "HEAD" ? undefined : "Erro ao carregar a interface.");
    }
  });
  server.once('close', () => api.close());
  return server;
}

if (require.main === module) {
  const port = Number(process.env.PORT || 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    console.error("PORT deve ser um número entre 1 e 65535.");
    process.exitCode = 1;
  } else {
    const server = createServer();
    server.on("error", error => {
      console.error(error.code === "EADDRINUSE"
        ? `A porta ${port} já está em uso. Feche o outro servidor ou configure PORT.`
        : `Não foi possível iniciar: ${error.message}`);
      process.exitCode = 1;
    });
    server.listen(port, "127.0.0.1", () => {
      console.log(`NEXUS disponível em http://localhost:${port}`);
      console.log("Mantenha este terminal aberto. Para encerrar, pressione Ctrl+C.");
    });
  }
}

module.exports = { createServer };
