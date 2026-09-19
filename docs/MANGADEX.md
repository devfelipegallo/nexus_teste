# MangaDex no Nexus

Na aba Mangás, selecione MangaDex, escolha o idioma e busque um título. Abra a obra para ver capítulos e os créditos dos grupos de tradução. O leitor permite navegar pelas páginas e guarda o progresso neste navegador. O link “Ver no MangaDex” abre a obra original.

Não exige chave de API nem configuração no .env. Komga continua disponível no seletor de fontes. Reinicie o servidor Nexus após atualizar os arquivos.

O catálogo começa em português do Brasil, com filtros safe/suggestive e paginação de 30 obras. Capítulos são carregados em lotes de 100; use “Carregar mais capítulos”. A disponibilidade varia por obra e idioma. Links externos de capítulos não são incorporados ao leitor.

As rotas /api/mangadex exigem a sessão do Nexus. As consultas possuem cache de um minuto, timeout, limitação de requisições e tratamento de erro 429. Capas e páginas passam pelo servidor local; somente hosts HTTPS do MangaDex são aceitos. O cache de páginas não é uma cópia permanente da coleção.

Documentação: https://api.mangadex.org/docs/
Respeite as condições de uso do MangaDex, a atribuição dos grupos e os pedidos de remoção. A integração não garante que um título tenha todos os capítulos.
