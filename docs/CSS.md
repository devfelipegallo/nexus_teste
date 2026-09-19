# Organização do CSS — etapa 1

O painel usa HTML, CSS e JavaScript puro. A separação mantém os seletores,
declarações e breakpoints existentes; não altera dimensões nem eventos.

## Arquivos

- `src/styles/global.css`: variáveis, cores, fonte, fundo, reset e foco.
- `src/styles/components/layout.css`: estrutura e contêineres do painel.
- `src/styles/components/header.css`: cabeçalho, navegação e conta.
- `src/styles/components/controls.css`: buscas, botões compartilhados, mensagens e rolagem.
- `src/styles/components/sidebar.css`: biblioteca lateral, usada em músicas.
- `src/styles/components/account.css`: configurações da conta.
- `src/styles/components/dialogs.css`: base dos modais e notificações.
- `src/styles/filmes.css`: catálogo de filmes e séries.
- `src/styles/musicas.css`: catálogo musical, menus de faixas e player.
- `src/styles/mangas.css`: catálogo, detalhes e leitor de mangás.
- `src/styles/perfil.css`: página de perfil, servida pelo HTML de mangás.

Login e administração continuam com seus arquivos próprios (`index.css` e
`admin.css`), sem receber o tema do painel de usuário.

## Carregamento e manutenção

Cada HTML carrega global, layout, header e controles; em seguida, os estilos
da página e, por último, configurações e modais. A base de modais permanece
depois das regras específicas, como na cascata original. As regras responsivas
ficam no arquivo do elemento correspondente, na mesma ordem relativa de antes.
As rotas de CSS são explicitamente autorizadas em `server.js`.

`mangas.html` atende catálogo, detalhes e perfil, por isso carrega `mangas.css`
e `perfil.css`. Filmes e músicas não carregam esses arquivos. `painel.html`
acompanha filmes, assim como o alias `/painel`.

Nenhum `!important` foi acrescentado: os existentes foram mantidos para não
alterar a prioridade sobre os utilitários Tailwind. Regras complementares do
mesmo seletor também foram preservadas. O antigo `painel.css` foi substituído.

## Validação manual desta etapa

Reinicie o servidor Node e recarregue a página. Confira filmes, músicas, mangás
e perfil em desktop e celular: header, busca, biblioteca lateral, player,
configurações e modais. O header HTML compartilhado será a próxima etapa,
após a aprovação desta separação.
