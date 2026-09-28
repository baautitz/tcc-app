# tcc-backend

API Hono para dashboards com hidratação assíncrona de componentes. A plataforma usa o `DATABASE_URL` apenas para seus próprios dados; cada query analítica executa em um servidor PostgreSQL externo cadastrado e validado como somente-leitura.

## Desenvolvimento

1. Copie `.env.example` para `.env` e configure um PostgreSQL da plataforma.
2. Gere uma chave segura: `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`.
3. Execute `pnpm install`, `pnpm db:migrate`, `pnpm db:seed` e `pnpm dev`.

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
