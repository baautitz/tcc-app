# tcc-backend

API Hono para dashboards com hidratação assíncrona de componentes. A plataforma usa o `DATABASE_URL` apenas para seus próprios dados; cada query analítica executa em um servidor PostgreSQL externo cadastrado e validado como somente-leitura.

## Desenvolvimento

1. Copie `.env.example` para `.env` e configure um PostgreSQL da plataforma.
2. Gere uma chave segura: `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`.
3. Execute `pnpm install`, `pnpm db:migrate`, `pnpm db:seed` e `pnpm dev`.

O seed de desenvolvimento cria `admin@tcc.local` com senha `Admin@123`. Troque ou remova esse acesso antes de expor a aplicação.

A recipe SDUI é validada como JSON e registrada no PostgreSQL apenas como referência (`source_uri`) e checksum. Em produção, o registro da recipe deve apontar para uma URL HTTPS (por exemplo, uma URL presigned do S3); o backend revalida a origem em runtime.

Para registrar uma origem remota durante o seed, execute `pnpm db:seed -- https://...`.

## Segurança de servidores externos

O cadastro testa a conexão, rejeita superusuários e privilégios de escrita/DDL/TEMP, cataloga tabelas de usuário e cifra a senha com AES-256-GCM. A chave `CREDENTIAL_ENCRYPTION_KEY` nunca pode ser versionada ou enviada ao frontend.

As queries aceitam somente uma instrução `SELECT`/`WITH`, com parâmetros `{{nome}}` convertidos pelo backend em bind parameters do PostgreSQL. A conta externa somente-leitura é a proteção final.
