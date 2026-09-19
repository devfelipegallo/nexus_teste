# Komga no NEXUS

O Komga roda como um serviço separado e o NEXUS acessa sua API pelo servidor
Node.js. As credenciais nunca são enviadas ao navegador.

## 1. Iniciar o Komga no Windows

O pacote portátil oficial do Komga fica em `komga/runtime`. Para iniciá-lo,
execute na raiz do projeto:

```powershell
npm run komga:start
```

Abra `http://localhost:25600`, crie a conta principal e deixe o idioma da
interface como Português (Brasil).

Se a pasta `komga/runtime` ainda não existir, baixe a versão Windows `.zip` em
`https://download.komga.org`, extraia o conteúdo nessa pasta e execute novamente.

### Alternativa com Docker

Caso instale o Docker Desktop no futuro, também pode usar:

```powershell
docker compose -f docker-compose.komga.yml up -d
```

## 2. Criar a biblioteca

Coloque seus arquivos em `komga/library`. Na versão Windows, crie uma biblioteca
no painel do Komga apontando para o caminho completo dessa pasta. Com Docker, ela
aparece dentro do contêiner como `/data`. São aceitos formatos como CBZ, CBR, PDF
e EPUB.

O Komga organiza arquivos que você possui; ele não baixa nem fornece obras.

## 3. Conectar o NEXUS

Adicione ao `.env`:

```dotenv
KOMGA_URL=http://localhost:25600
KOMGA_USERNAME=email-da-conta-komga
KOMGA_PASSWORD=senha-da-conta-komga
```

Reinicie o NEXUS com `npm start`. A aba **Mangás** mostrará as séries, capas,
volumes e capítulos. A leitura ocorre dentro do NEXUS e o progresso local fica
salvo no navegador.

## Arquivos da integração

- `docker-compose.komga.yml`: serviço Komga e pastas persistentes.
- `src/server/komga.js`: cliente seguro da API do Komga.
- `src/server/api.js`: rotas protegidas usadas pela interface.
- `src/pages/painel.html`: catálogo, detalhes e leitor.
- `src/main.js`: busca, navegação e leitura.

As rotas do NEXUS exigem login. As imagens são encaminhadas pelo servidor para
que a senha do Komga não apareça no código da página.
