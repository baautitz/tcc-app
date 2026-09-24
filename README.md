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

## Base analítica Olist

O arquivo `archive.zip` contém os CSVs do conjunto Olist; ele alimenta uma base
analítica separada do banco interno da plataforma. Extraia os nove arquivos
diretamente em `postgres/olist/data/` (ignorado pelo Git). O `init.sql` os carrega
automaticamente na primeira criação do volume Docker.

```bash
unzip /home/vinicius/Desktop/archive.zip -d postgres/olist/data
docker compose up -d olist-postgres
```

O primeiro start pode levar alguns minutos. Ao finalizar, conecte a fonte externa
na aplicação com os seguintes dados locais:

| Campo | Valor |
| --- | --- |
| Nome | `olist` |
| Host | `localhost` |
| Porta | `5433` |
| Banco | `olist` |
| Usuário | `olist_reader` |
| Senha | `olist_readonly_password` |

As tabelas estão no schema `olist` (por exemplo, `olist.orders` e
`olist.order_items`). O usuário de leitura não possui privilégios de escrita,
DDL, `TEMP` ou superusuário, conforme a validação da API.

Para usar senhas diferentes, defina `OLIST_POSTGRES_PASSWORD` e
`OLIST_READER_PASSWORD` antes de criar o volume. Os scripts em
`docker-entrypoint-initdb.d` só são executados com o volume vazio; para recriar a
base, remova especificamente o volume `olist_postgres_data` após parar e remover
o respectivo container, então suba o serviço novamente.
