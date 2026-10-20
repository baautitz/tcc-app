# Arquitetura

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

Backend, testes sem banco real:

```
DATABASE_URL=postgres://u:p@localhost:5432/db CREDENTIAL_ENCRYPTION_KEY=<base64 de 32 bytes> pnpm test
```

Cinco testes ficam ignorados porque exigem um Postgres descartável. `TCC_POSTGRES_INTEGRATION=1` habilita três deles. Nunca aponte esses testes para o banco de desenvolvimento.

## Dívidas conhecidas

- `queries` e `dashboards` se referem via `DashboardFilesPort` sem ciclo de construção: o adapter de arquivos não depende de `QueryService`, então entra direto no construtor.
- Backend em classes (services, repositórios Drizzle, adapters, instância única por construtor). Ficaram como funções os módulos puros sem estado (`external-pg/*`, `domain/*`). No frontend, só os `<modulo>.api.ts` viraram classes; hooks e componentes seguem funções.
- Dois casos `it.skip` fixos em `tests/http/app.routes.test.ts` (motivo documentado no teste: transações reais e arquivos em disco).
- O frontend não tem script de lint.
