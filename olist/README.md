# Base analítica Olist

Projeto autônomo de PostgreSQL 18 para o conjunto de e-commerce Olist. Ele não
depende dos serviços do TCC App, embora possa ser cadastrado nele como uma fonte
de dados externa somente leitura.

## Subir a base do zero

1. Baixe o conjunto no [Kaggle](https://www.kaggle.com/datasets/olistbr/brazilian-ecommerce?resource=download).
2. Extraia os nove CSVs na pasta `data/`:

   ```bash
   unzip /caminho/para/archive.zip -d data
   ```

3. Opcionalmente, copie `.env.example` para `.env` e troque as senhas locais.
4. Inicie o banco:

   ```bash
   docker compose up -d
   docker compose ps
   ```

Na primeira execução, o `init.sql` carrega e normaliza os CSVs. Aguarde o status
`healthy` antes de conectar. O volume preserva os dados nas próximas execuções.

## Conexão local

| Campo | Valor padrão |
| --- | --- |
| Host | `localhost` |
| Porta | `5433` |
| Banco | `olist` |
| Proprietário | `olist_owner` |
| Leitor inicial | `olist_reader` |

As senhas de desenvolvimento estão em `.env.example`; altere-as antes de expor o
serviço fora da máquina local.

## Modelo normalizado

Os CSVs entram temporariamente no schema `staging`, que é apagado ao término da
carga. O schema final `olist` possui 18 chaves estrangeiras e inclui:

- `customers` e `order_customers`: identidade do comprador e o registro de
  cliente específico de cada pedido;
- `orders`, `order_items`, `order_payments` e `order_reviews`;
- `products`, `categories`, `sellers`, `payment_methods` e `reviews`;
- `states`, `cities`, `zip_code_prefixes` e `geolocations`.

As avaliações são separadas em `reviews` e na relação N:N `order_reviews`. CEPs
não são ligados diretamente a cidades porque o conjunto possui múltiplas cidades
para o mesmo prefixo; ambos se relacionam de forma independente às geolocalizações.

## Criar outro usuário somente leitura

O script é idempotente: cria o papel se ele não existir ou reaplica as permissões
de leitura se já existir. Informe valores seguros no lugar dos exemplos:

```bash
docker exec -i olist-postgres \
  psql -U olist_owner -d olist -v ON_ERROR_STOP=1 \
  -v readonly_user=analista \
  -v readonly_password='SenhaSegura@123' \
  < sql/create-readonly-user.sql
```

O usuário recebe apenas `CONNECT`, `USAGE` no schema `olist` e `SELECT` nas
tabelas presentes e futuras. O script recusa modificar o proprietário do banco ou
um superusuário.

## Recriar a base

Como este diretório possui Compose próprio, o reset não afeta os demais serviços
do repositório:

```bash
docker compose down --volumes
docker compose up -d
```
