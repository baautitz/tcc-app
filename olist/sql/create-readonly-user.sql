\set ON_ERROR_STOP on

\if :{?readonly_user}
\else
  \echo 'Informe -v readonly_user=nome_do_usuario.'
  \quit
\endif

\if :{?readonly_password}
\else
  \echo 'Informe -v readonly_password=uma_senha_segura.'
  \quit
\endif

SELECT
  (:'readonly_user' = current_user) AS target_is_current_user,
  COALESCE((SELECT rolsuper FROM pg_roles WHERE rolname = :'readonly_user'), false) AS target_is_superuser,
  EXISTS(SELECT 1 FROM pg_roles WHERE rolname = :'readonly_user') AS target_exists
\gset

\if :target_is_current_user
  \echo 'O usuário de leitura não pode ser o mesmo usuário que executa o script.'
  \quit
\endif

\if :target_is_superuser
  \echo 'O script não altera um papel que já é superusuário.'
  \quit
\endif

BEGIN;

\if :target_exists
  ALTER ROLE :"readonly_user"
    LOGIN
    NOSUPERUSER
    NOCREATEDB
    NOCREATEROLE
    NOINHERIT
    NOREPLICATION
    NOBYPASSRLS
    PASSWORD :'readonly_password';
\else
  CREATE ROLE :"readonly_user"
    LOGIN
    NOSUPERUSER
    NOCREATEDB
    NOCREATEROLE
    NOINHERIT
    NOREPLICATION
    NOBYPASSRLS
    PASSWORD :'readonly_password';
\endif

ALTER ROLE :"readonly_user" SET default_transaction_read_only = on;
ALTER ROLE :"readonly_user" SET search_path = olist, pg_catalog;

REVOKE ALL ON DATABASE olist FROM :"readonly_user";
GRANT CONNECT ON DATABASE olist TO :"readonly_user";
REVOKE ALL ON SCHEMA public FROM :"readonly_user";
REVOKE ALL ON SCHEMA olist FROM :"readonly_user";
GRANT USAGE ON SCHEMA olist TO :"readonly_user";
REVOKE ALL ON ALL TABLES IN SCHEMA olist FROM :"readonly_user";
GRANT SELECT ON ALL TABLES IN SCHEMA olist TO :"readonly_user";
ALTER DEFAULT PRIVILEGES FOR ROLE olist_owner IN SCHEMA olist
  GRANT SELECT ON TABLES TO :"readonly_user";

COMMIT;

\echo 'Usuário de leitura configurado com sucesso.'
