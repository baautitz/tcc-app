import { eq } from "drizzle-orm";
import { db, pool } from "./shared/db/client.js";
import {
  dataSources,
  permissions,
  savedQueries,
  users,
} from "./shared/db/schema.js";
import { getEnvironment } from "./shared/config/config.js";
import { encryptCredential } from "./shared/lib/credentials.js";
import type { ParameterDefinition } from "./shared/lib/contracts.js";
import { hashPassword } from "./shared/lib/passwords.js";
import { permissionService } from "./modules/identity/application/permissions.js";
import { syncDashboardDirectory } from "./modules/dashboards/application/dashboard-registry.js";

const ADMIN_EMAIL = "admin@tcc.local";
const ADMIN_PASSWORD = "Admin@123";
const DEMO_SOURCE_ID = "00000000-0000-4000-8000-000000000010";

const demoQueries = [
  {
    id: "00000000-0000-4000-8000-000000000001",
    name: "Categorias Olist",
    sqlText:
      "SELECT category_name AS value, COALESCE(category_name_english, category_name) AS label FROM olist.categories ORDER BY label",
    parameters: [] as ParameterDefinition[],
  },
  {
    id: "00000000-0000-4000-8000-000000000002",
    name: "Vendas por Vendedor",
    sqlText: `WITH vendas_vendedor AS (
  SELECT oi.seller_id AS vendedor_id, CONCAT(city.name, '/', city.state_code, ' · ', oi.seller_id) AS vendedor, SUM(oi.price) AS venda_geral
FROM olist.orders o
INNER JOIN olist.order_items oi ON oi.order_id = o.order_id
INNER JOIN olist.products p ON p.product_id = oi.product_id
INNER JOIN olist.sellers s ON s.seller_id = oi.seller_id
INNER JOIN olist.cities city ON city.city_id = s.city_id
WHERE o.purchased_at >= {{start_date}}::date
  AND o.purchased_at < ({{end_date}}::date + INTERVAL '1 day')
  AND ({{categories}}::text[] IS NULL OR p.category_name = ANY({{categories}}::text[]))
GROUP BY oi.seller_id, city.name, city.state_code
)
SELECT ROW_NUMBER() OVER (ORDER BY venda_geral DESC, vendedor_id) AS ranking, vendedor_id, vendedor, venda_geral
FROM vendas_vendedor
ORDER BY ranking`,
    parameters: [
      {
        name: "start_date",
        label: "Data Inicial",
        type: "date",
        required: true,
      },
      { name: "end_date", label: "Data Final", type: "date", required: true },
      {
        name: "categories",
        label: "Categorias",
        type: "multi_select",
        required: false,
      },
    ] as ParameterDefinition[],
  },
  {
    id: "00000000-0000-4000-8000-000000000003",
    name: "Total em Produtos",
    sqlText: `SELECT COALESCE(SUM(oi.price), 0) AS total_vendas
FROM olist.orders o
INNER JOIN olist.order_items oi ON oi.order_id = o.order_id
INNER JOIN olist.products p ON p.product_id = oi.product_id
WHERE o.purchased_at >= {{start_date}}::date
  AND o.purchased_at < ({{end_date}}::date + INTERVAL '1 day')
  AND ({{categories}}::text[] IS NULL OR p.category_name = ANY({{categories}}::text[]))`,
    parameters: [
      {
        name: "start_date",
        label: "Data Inicial",
        type: "date",
        required: true,
      },
      { name: "end_date", label: "Data Final", type: "date", required: true },
      {
        name: "categories",
        label: "Categorias",
        type: "multi_select",
        required: false,
      },
    ] as ParameterDefinition[],
  },
];

async function seedDemoDataSource(administratorId: string): Promise<void> {
  const port = Number(process.env.OLIST_SOURCE_PORT ?? "5433");
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(
      "OLIST_SOURCE_PORT deve ser uma porta válida entre 1 e 65535.",
    );
  }
  const environment = getEnvironment();
  const source = {
    id: DEMO_SOURCE_ID,
    name: "Olist (teste local)",
    host: process.env.OLIST_SOURCE_HOST ?? "127.0.0.1",
    port,
    databaseName: process.env.OLIST_SOURCE_DATABASE ?? "olist",
    username: process.env.OLIST_SOURCE_USERNAME ?? "olist_reader",
    encryptedPassword: encryptCredential(
      process.env.OLIST_SOURCE_PASSWORD ?? "olist_readonly_password",
      environment.CREDENTIAL_ENCRYPTION_KEY,
    ),
    context:
      "Fonte analítica local usada pelas queries de demonstração do dashboard Fechamento de Mês.",
    createdBy: administratorId,
  };
  await db
    .insert(dataSources)
    .values(source)
    .onConflictDoNothing({ target: dataSources.id });
  const savedSource = (
    await db
      .select({ id: dataSources.id })
      .from(dataSources)
      .where(eq(dataSources.id, DEMO_SOURCE_ID))
      .limit(1)
  )[0];
  if (!savedSource)
    throw new Error(
      "O nome da fonte de teste já está associado a outro registro.",
    );

  for (const query of demoQueries) {
    const queryValues = {
      ...query,
      dataSourceId: DEMO_SOURCE_ID,
      createdBy: administratorId,
    };
    if (query.id === "00000000-0000-4000-8000-000000000002") {
      await db
        .insert(savedQueries)
        .values(queryValues)
        .onConflictDoUpdate({
          target: savedQueries.id,
          set: { sqlText: query.sqlText, parameters: query.parameters },
        });
    } else {
      await db
        .insert(savedQueries)
        .values(queryValues)
        .onConflictDoNothing({ target: savedQueries.id });
    }
  }
}

try {
  await permissionService.ensureSystemPermissions();
  const existingAdmin = await db
    .select()
    .from(users)
    .where(eq(users.email, ADMIN_EMAIL))
    .limit(1);
  const administrator =
    existingAdmin[0] ??
    (
      await db
        .insert(users)
        .values({
          name: "Administrador TCC",
          email: ADMIN_EMAIL,
          passwordHash: hashPassword(ADMIN_PASSWORD),
          isAdmin: true,
        })
        .returning()
    )[0];

  if (!administrator)
    throw new Error("Não foi possível criar o administrador inicial.");
  await db
    .update(users)
    .set({ isAdmin: true })
    .where(eq(users.id, administrator.id));
  const systemPermissionKeys = (
    await db
      .select({ key: permissions.key })
      .from(permissions)
      .where(eq(permissions.system, true))
  ).map((permission) => permission.key);
  await permissionService.assignPermissionKeys(
    administrator.id,
    systemPermissionKeys,
  );
  await seedDemoDataSource(administrator.id);
  await syncDashboardDirectory();
  console.info(`Administrador de desenvolvimento pronto: ${ADMIN_EMAIL}`);
} finally {
  await pool.end();
}
