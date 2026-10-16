import { defineConfig } from "drizzle-kit";
import * as dotenv from "dotenv";

// Load environment variables from .env file.
dotenv.config();

const dbHost = process.env.DB_HOST || process.env.SQL_HOST || "localhost";
const dbPort = Number(process.env.DB_PORT || process.env.SQL_PORT || 3306);
const dbName = process.env.DB_NAME || process.env.SQL_DB_NAME || "hd_warehouse";
const user = process.env.DB_USER || process.env.SQL_ADMIN_USER || process.env.SQL_USER || "root";
const password = process.env.DB_PASSWORD ?? process.env.SQL_ADMIN_PASSWORD ?? process.env.SQL_PASSWORD ?? "";

console.log(`Using user: ${user} to connect to MySQL database ${dbName} on ${dbHost}:${dbPort}.`);

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "mysql",
  dbCredentials: {
    host: dbHost,
    port: dbPort,
    user: user,
    password: password,
    database: dbName,
  },
  verbose: true,
});
