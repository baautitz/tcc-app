# Arquitetura

Vocabulário do domínio: veja o [GLOSSARY.md](../GLOSSARY.md).

Backend (`tcc-backend`) e frontend (`tcc-frontend`) são organizados por módulo de domínio. Os dois usam os mesmos cinco módulos e os mesmos nomes.

## Módulos e direção de dependência

```
identity <- data-sources <- queries <- dashboards <- ai
```

A seta significa "é usado por". O `ai` depende de todos, e ninguém depende do `ai`. Nenhum ciclo é permitido.

| Módulo | Responsabilidade | Rotas do backend |
|---|---|---|
| identity | autenticação, usuários, permissões (catálogo somente leitura) | `/api/auth`, `/api/users`, `/api/permissions` |
| data-sources | fontes de dados externas, catálogo e contexto das tabelas | `/api/data-sources` |
| queries | queries salvas, ciclo de vida, execução pública | `/api/queries` |
| dashboards | dashboards, acesso, sincronização, propostas | `/api/dashboards`, `/api/admin/dashboards`, `GET /query/:uuid` |
| ai | agente, chat, ferramentas, propostas de contexto | `/api/admin/ai` |

As rotas de preview e commit de `dashboard-proposals` ficam sob `/api/admin/ai/dashboard-proposals`, mas o handler pertence a `dashboards`.

## Backend

```
src/
  modules/<modulo>/{domain,application,infrastructure,http}
  shared/{config,db,middleware,lib,security}
  app.ts  index.ts  seed.ts       # composição
tests/http/                       # testes de integração entre módulos
```

- `domain` não importa `application`, `infrastructure` nem `http`. `application` não importa `http`.
- Um módulo só importa `domain` e `application` de outro módulo, na direção acima. `infrastructure` e `http` de outro módulo são proibidos.
- `shared` não importa de `modules`. A exceção é `shared/middleware/auth`, que usa `identity`.
- Dependências entre módulos passam por portas (`DashboardFilesPort`, `ExternalSourcePort`, `SavedQueriesPort`), injetadas por construtor em `src/container.ts`. Não há portas globais mutáveis; controllers importam os services do container.
- Pontos de composição (`container.ts`, `app.ts`, `index.ts`, `seed.ts`, `tests/`) podem importar de qualquer módulo.
- A ordem de montagem de `app.route("/")` em `app.ts` faz parte do contrato. Mude com cuidado.

## Frontend

```
src/
  app/        # main, providers, rotas, layout, admin
  modules/<modulo>/{api,model,hooks,components,pages}
  shared/     # ui, crud, api client, lib, context, layout
```

- `modules` não importa de `app`. `shared` não importa de `modules` nem de `app`.
- Direção entre módulos igual à do backend. No frontend, `queries` usa `data-sources` (a tela lista as fontes) e `ai` usa `dashboards`.
- Cada módulo tem seu `<modulo>.api.ts` e seu `model/types.ts`.

## Verificação

Rode `pnpm arch` em cada projeto. Ele falha se houver ciclo ou import na direção errada. A regra está em `.dependency-cruiser.cjs`.

Smoke com Postgres descartável (docker, container próprio removido ao fim): `tcc-backend/scripts/smoke-context-approvals.sh`.
Contrato de rotas: `tests/contract/routes.snapshot.test.ts` compara método+path com `routes.snapshot.txt`; após mudar rotas de propósito, regenere com `UPDATE_ROUTES=1 pnpm vitest run tests/contract`.

Backend, testes sem banco real:

```
DATABASE_URL=postgres://u:p@localhost:5432/db CREDENTIAL_ENCRYPTION_KEY=<base64 de 32 bytes> pnpm test
```

Oito testes (`tests/http/*.integration.test.ts`) ficam ignorados porque exigem um Postgres descartável. `TCC_POSTGRES_INTEGRATION=1` habilita todos; o helper recusa bancos cujo nome não contenha `smoke`, `skip` ou `test`. Alguns também precisam de `TCC_SMOKE_EXTERNAL_PORT` (2ª porta loopback). Nunca aponte esses testes para o banco de desenvolvimento. Em CI, `.github/workflows/backend-integration.yml` sobe um serviço Postgres (portas 5432 e 5433) e roda a suíte com a flag ligada.

## Dívidas conhecidas

- `queries` e `dashboards` se referem via `DashboardFilesPort` sem ciclo de construção: o adapter de arquivos não depende de `QueryService`, então entra direto no construtor.
- Backend em classes (services, repositórios Drizzle, adapters, instância única por construtor). Ficaram como funções os módulos puros sem estado (`external-pg/*`, `domain/*`). No frontend, só os `<modulo>.api.ts` viraram classes; hooks e componentes seguem funções.
- Os dois `it.skip` antigos de `app.routes.test.ts` viraram `queries-receipt.integration.test.ts` e `dashboard-proposals.integration.test.ts`. Atenção: o skip dizia "propostas de contexto de IA", mas o preview/commit com arquivos em disco é o de propostas de dashboard (`/api/admin/ai/dashboard-proposals/:id/preview|commit`); o ciclo de propostas de contexto já era coberto por `ai-context-proposals.integration.test.ts`.
- Seis warnings de `react-hooks/exhaustive-deps` no frontend (lint roda, mas não zera).
- Pendências abertas no GitHub (baautitz/tcc-app): #1 teste manual das telas após refatoração de hooks; #6 destino dos stashes antigos; #7 hooks e componentes em OOP (opcional, não recomendado: funções são idiomáticas em React).
