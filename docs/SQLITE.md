# SQLite no NEXUS

Requisito: Node.js 24 ou superior. A integração usa `node:sqlite`, sem dependências adicionais.

Na pasta do projeto, execute:

```sh
npm start
```

Abra http://localhost:3000. O login e a tabela agora dependem do servidor Node.js;
o Live Server sozinho não fornece a API.

## Banco e acesso inicial

O arquivo `data/nexus.sqlite` é criado automaticamente na primeira inicialização.
Não é necessário criar a tabela manualmente. Antes da primeira execução, defina
`NEXUS_ADMIN_PASSWORD` no `.env`. Se a variável estiver vazia, o servidor gera uma
senha aleatória forte e a mostra uma única vez no terminal.

Por padrão, somente a conta `admin` é criada. Para um ambiente descartável de
demonstração, `NEXUS_SEED_DEMO=1` também cria `user` e `visitante`; não use essa
opção em uma instalação real.

Essas contas são criadas apenas na primeira inicialização. Cadastros, alterações
e exclusões permanecem no arquivo após reiniciar. A sessão de login dura até oito
horas e é encerrada ao reiniciar o servidor. Faça login novamente nesse caso.

Os dados da antiga simulação em sessionStorage não são importados automaticamente.

As senhas são salvas como hash com salt; a API não devolve senhas nem hashes.
Ao abrir um banco existente, o servidor avisa no terminal se detectar alguma das
credenciais antigas conhecidas, para que o administrador possa substituí-las.
Na edição, deixe a senha vazia para manter a atual. Somente o administrador pode
listar, criar, editar e remover usuários. O administrador principal fica protegido
contra alteração por essa tela. Desativar/remover um usuário ou trocar sua senha
encerra suas sessões.

## Arquivos

- `src/server/database.js`: tabela, contas iniciais e consultas parametrizadas.
- `src/server/api.js`: login, sessão e operações de usuários.
- `server.js`: interface e API no mesmo endereço.
- `src/main.js`: conecta os formulários à API.
- `data/nexus.sqlite`: dados persistentes; não publicar no Git.

O `.gitignore` ignora `data/` e `.env`. A organização mantém essa
configuração. Se ela for revisada no futuro, mantenha `data/` e `.env` ignorados.

Para copiar o banco, encerre o servidor e copie a pasta `data` completa,
incluindo eventuais arquivos `-wal` e `-shm`. Não apague essa pasta para atualizar o código.

Referência: https://nodejs.org/download/release/latest-v24.x/docs/api/sqlite.html
