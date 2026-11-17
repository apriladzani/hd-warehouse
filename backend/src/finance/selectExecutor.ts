// A SELECT-only query port. Finance reads go through it; the guard refuses any
// statement that could write or lock, on top of the read-only DB account/session.
export interface SelectExecutor { select(sql: string, parameters: readonly unknown[]): Promise<Record<string, unknown>[]> }

export function mysqlSelectExecutor(connection: { execute: (sql: string, parameters: any[]) => Promise<any> }): SelectExecutor {
  return { async select(sql, parameters) {
    if (!/^SELECT\s/i.test(sql) || /;|\b(?:INTO|FOR\s+(?:UPDATE|SHARE)|LOCK|SLEEP|BENCHMARK)\b/i.test(sql)) throw new Error('Only read queries permitted');
    const [rows] = await connection.execute(sql, [...parameters]);
    return rows;
  } };
}
