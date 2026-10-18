import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { getEnvironment } from "../config/config.js";

const environment = getEnvironment();

export const pool = new Pool({ connectionString: environment.DATABASE_URL });
export const db = drizzle({ client: pool });
