# Informações das músicas

Na raiz do projeto, preencha o `.env`:

```dotenv
SPOTIFY_CLIENT_ID=
SPOTIFY_CLIENT_SECRET=
LASTFM_API_KEY=
SPOTIFY_MARKET=BR
```

Obtenha as credenciais em https://developer.spotify.com/dashboard e https://www.last.fm/api/account/create.
As chaves ficam somente no servidor. Não envie nem publique o `.env`.

Reinicie com `npm start` e abra a aba Músicas. O ranking global e a pesquisa usam
somente o Spotify. A pesquisa retorna músicas, artistas e álbuns, todos com link direto
para a página correspondente no Spotify. O Last.fm é usado apenas para completar os
metadados e as capas das músicas locais quando necessário.
Cada faixa é comparada por título e artista para evitar associar músicas de mesmo nome.
Os links de origem aparecem junto das informações. Os resultados ficam em memória por
até dez minutos; erros e ausência de resultado são guardados por um minuto.

As APIs fornecem artista/intérprete, não necessariamente o compositor ou autor da letra.
A minutagem do catálogo aparece antes de reproduzir; depois, vale a duração real do
arquivo local para manter a barra e o áudio sincronizados.

Se uma chave faltar, o serviço correspondente é ignorado. Sem credenciais válidas do
Spotify, a pesquisa e o ranking exibem uma mensagem de configuração, mas as músicas
locais continuam disponíveis. Erros de rede, limite de requisições ou músicas não
encontradas mantêm os dados locais e não impedem tocar.
Não há download ou streaming de áudio do Spotify ou Last.fm: a reprodução continua
usando os arquivos da pasta `src/assets/songs`. O item “Baixar arquivo” no menu de três
pontos entrega somente o MP3 local correspondente, como anexo.

Para cadastrar outra faixa no HTML, preencha `data-src`, `data-title`, `data-artist`,
`data-query-title` e `data-query-artist`. Use no campo de consulta o nome principal do
artista, sem créditos de produção. Siga a estrutura das três linhas com `data-music-row`,
incluindo os campos de capa, título, artista, duração e links.

Referências:
- https://developer.spotify.com/documentation/web-api/tutorials/client-credentials-flow
- https://developer.spotify.com/documentation/web-api/reference/search
- https://developer.spotify.com/documentation/web-api/reference/get-playlists-items
- https://www.last.fm/api/show/track.getInfo
