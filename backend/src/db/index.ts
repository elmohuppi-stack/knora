import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema.ts";

const connectionString = process.env.DATABASE_URL!;

const pool = new Pool({
  connectionString,
  max: 5,
  idleTimeoutMillis: 10000,
  connectionTimeoutMillis: 5000,
});

export const db = drizzle(pool, { schema });
export type DB = typeof db;
