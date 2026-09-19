# Dados de mangás com Jikan

O NEXUS usa a API pública Jikan v4 para complementar a ficha individual dos mangás. Não é necessário cadastrar uma chave.

Ao abrir uma obra, o servidor pesquisa o título no Jikan e aceita somente uma correspondência próxima. Quando encontrada, a ficha pode receber status de publicação, gêneros, quantidade oficial de capítulos e volumes, ano de lançamento, autores e sinopse.

MangaDex ou Komga continuam responsáveis pelo catálogo, capas, capítulos e páginas de leitura. Se o Jikan estiver indisponível ou não encontrar uma correspondência segura, a página continua funcionando com os dados do provedor original.

As respostas bem-sucedidas ficam em cache por seis horas para reduzir chamadas à API pública.

Documentação: https://docs.api.jikan.moe/
