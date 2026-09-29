# tcc-backend

API Hono para dashboards com hidratação assíncrona de componentes. A plataforma usa o `DATABASE_URL` apenas para seus próprios dados; cada query analítica executa em um servidor PostgreSQL externo cadastrado e validado como somente-leitura.

## Desenvolvimento

1. Copie `.env.example` para `.env` e configure um PostgreSQL da plataforma.
2. Gere uma chave segura: `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`.
3. Execute `pnpm install`, `pnpm db:migrate`, `pnpm db:seed` e `pnpm dev`.

### Smoke das aprovações de contexto

`pnpm smoke:context-approvals` exige Docker, Python 3 e dependências instaladas. O comando cria um container temporário `postgres:18-alpine`, aplica as migrations 0000–0003, executa as rotas reais de autenticação, aprovação e atualização de fonte/tabela contra esse banco e remove o container ao terminar. Ele valida 401/403/admin, isolamento entre administradores, aprovação serializada, conflito CAS e invalidação de propostas/contextos ao trocar o endpoint.

O chat de IA é opcional. Para habilitá-lo, configure `AI_BASE_URL`, `AI_API_KEY` e `AI_MODEL` com um provedor compatível com **Chat Completions da OpenAI**, streaming SSE e chamadas de ferramentas (tool/function calling). `AI_BASE_URL` é a URL-base da API (normalmente termina em `/v1`); o backend acrescenta o caminho de Chat Completions. Não informe a URL completa `/chat/completions`. O provider precisa aceitar os campos `tools`/`tool_calls` e transmitir chunks SSE compatíveis. Providers OpenAI-compatible variam nos detalhes de schema, nomes de modelos e suporte a tools; valide os recursos do provider antes de habilitá-lo.

`AI_REQUEST_TIMEOUT_MS` limita cada resposta (padrão: 60000 ms; permitido: 1000 a 300000 ms). A saída fica limitada a 2048 tokens e o agente a 24 iterações. A chave fica somente no backend e não é retornada pelo endpoint de disponibilidade. Não configure `AI_API_KEY` no frontend. Se algum parâmetro estiver ausente ou inválido, a API continua disponível e `POST /api/admin/ai/chat` retorna `503` com o código de configuração correspondente.

A rota `POST /api/admin/ai/chat` exige sessão de administrador, recebe no máximo 30 mensagens `user`/`assistant` e não armazena o histórico. O corpo tem limite de 160 KiB, cada mensagem até 8000 caracteres e a conversa até 32000 caracteres. O contexto de navegação enviado pelo frontend ajuda a interpretar a tela atual; ele não concede permissões.

A resposta usa eventos SSE v1 (`start`, `token`, progresso de ferramentas, prévias de query/dashboard, propostas, `error` e `done`), cada um com `version: 1`. Ao exceder o prazo, retorna `error` com código `AI_TIMEOUT` e cancela a execução; desconectar o cliente também aborta a execução. Erros detalhados do provider são substituídos por mensagens sanitizadas no chat e não são escritos nos logs da rota.

O agente pode ler catálogo e contextos, testar queries em uma prévia somente-leitura com limites de linhas/bytes e propor dashboards usando queries salvas. Prévia não persiste alterações. Queries, dashboards e contextos exigem confirmação explícita do administrador; as propostas de contexto mostram a alteração para revisão, e propostas expiram e não podem ser reaplicadas após consumo. O histórico não é salvo pelo backend.

O seed de desenvolvimento cria `admin@tcc.local` com senha `Admin@123`, cadastra a fonte local `Olist (teste local)` e adiciona as três queries usadas pelo dashboard de exemplo **Fechamento de Mês**. Troque ou remova esse acesso antes de expor a aplicação.

Queries com os UUIDs de demonstração são inseridas somente quando ainda não existem. O seed sincroniza os dashboards JSON que já estiverem em `dashboards/` e não inclui nem cria uma cópia inicial do dashboard. As configurações da fonte Olist podem ser ajustadas pelas variáveis `OLIST_SOURCE_*` no `.env`; os valores padrão correspondem ao `olist/docker-compose.yml`. O seed não exige que essa fonte esteja ligada, mas os componentes só retornam dados quando o PostgreSQL analítico Olist estiver acessível e carregado com o conjunto de dados.

Dashboards são arquivos JSON locais em `dashboards/` e não são versionados no Git. Cada instalação mantém seus próprios arquivos. Ao criar um dashboard pela administração, o backend gera o UUID e grava imediatamente um JSON vazio como `dashboards/<uuid>.json`; o PostgreSQL registra o UUID e o caminho. O contexto do dashboard grava alterações diretamente nesse arquivo.

## Dashboards e queries

As definições SQL ficam em `saved_queries` no PostgreSQL da aplicação. Depois de cadastrar uma fonte de dados, crie queries na aba **Administração → Queries**, configure seus parâmetros e teste antes de salvar. Queries não têm usuários associados. Administradores podem executá-las; os demais usuários podem executar queries referenciadas por dashboards aos quais foram associados.

Na página do dashboard, o ícone de engrenagem abre o **Contexto do dashboard**, onde administradores definem filtros, componentes e vínculos de parâmetros com queries. O ícone de usuários abre a seleção de quem pode acessar aquele dashboard. Dashboards sem usuários associados ficam disponíveis somente para administradores. Os argumentos ficam em `workspace.params`; os vínculos ficam em `queryBindings.parameters`.

**Sincronizar JSONs** valida a estrutura dos arquivos em `dashboards/`, associa UUIDs e caminhos no PostgreSQL e remove associações sem arquivo correspondente. A sincronização não valida a existência das queries referenciadas. As migrations descrevem somente o esquema novo; para aplicar este projeto, use um banco vazio ou redefina o banco existente antes de executar `pnpm db:migrate`.

## Segurança de servidores externos

O cadastro testa a conexão, rejeita superusuários e privilégios de escrita/DDL/TEMP, cataloga tabelas de usuário e cifra a senha com AES-256-GCM. A chave `CREDENTIAL_ENCRYPTION_KEY` nunca pode ser versionada ou enviada ao frontend.

As queries aceitam somente uma instrução `SELECT`/`WITH`, com parâmetros `{{nome}}` convertidos pelo backend em bind parameters do PostgreSQL. A conta externa somente-leitura é a proteção final.
