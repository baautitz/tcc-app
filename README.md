# TCC App

Plataforma de dashboards Server-Driven UI para o TCC.

- `tcc-backend`: API Hono, PostgreSQL e Drizzle.
- `tcc-frontend`: SPA Vite/React servida por Nginx em produção.

Cada projeto possui dependências e ciclo de desenvolvimento próprios. Consulte os READMEs internos para configuração.

## Inicialização local

Suba o PostgreSQL da plataforma:

```bash
docker compose up -d postgres
```

O banco ficará disponível em `localhost:5432` com banco `tcc_platform`, usuário `tcc` e senha `tcc_local_password`. Essas credenciais são somente para desenvolvimento local.

Depois, inicialize a API:

```bash
cd tcc-backend
cp .env.example .env
pnpm install && pnpm db:migrate && pnpm db:seed && pnpm dev
```

Em outro terminal:

```bash
cd tcc-frontend
cp .env.example .env
pnpm install && pnpm dev
```
