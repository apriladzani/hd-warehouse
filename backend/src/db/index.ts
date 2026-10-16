import 'dotenv/config';
import { drizzle } from 'drizzle-orm/mysql2';
import mysql from 'mysql2/promise';
import * as schema from './schema.ts';

declare global {
  var _mysqlPool: mysql.Pool | undefined;
}

export const createPool = () => {
  if (!global._mysqlPool) {
    const password = process.env.DB_PASSWORD ?? process.env.SQL_PASSWORD ?? '';
    global._mysqlPool = mysql.createPool({
      host: process.env.DB_HOST || process.env.SQL_HOST || 'localhost',
      port: Number(process.env.DB_PORT || process.env.SQL_PORT || 3306),
      user: process.env.DB_USER || process.env.SQL_USER || 'root',
      password: password,
      database: process.env.DB_NAME || process.env.SQL_DB_NAME || 'hd_warehouse',
      waitForConnections: true,
      connectionLimit: 10,
      queueLimit: 0,
    });
  }
  return global._mysqlPool;
};

export const pool = createPool();
export const db = drizzle(pool, { schema, mode: 'default' });
