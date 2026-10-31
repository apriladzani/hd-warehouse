// Widens created_at to TIMESTAMP(3) on the tables whose rows are ordered against
// stock opname cut-offs. Without it, a transaction saved in the same second as a
// cut-off can fall on the wrong side of it and land in a period already closed.
// ALTER TABLE rewrites the table and is not transactional: run it during a quiet
// moment, with a backup, and never while the app is writing.
//   npm run db:migrate-timestamps             # show what would change
//   npm run db:migrate-timestamps -- --apply  # change it
import { pool } from '../src/db/index.ts';
import { MILLISECOND_COLUMN_DEFINITION, MILLISECOND_TIMESTAMP_TABLES, needsMillisecondPrecision } from '../src/db/timestampPrecision.ts';

const apply = process.argv.includes('--apply');
try {
  const columns = [];
  for (const table of MILLISECOND_TIMESTAMP_TABLES) {
    // A table that does not exist yet is created with the right type by the app.
    const column = await pool.query(`SHOW COLUMNS FROM \`${table}\` LIKE 'created_at'`).then(([rows]) => (rows as any[])[0], () => null);
    columns.push({ table, type: column ? String(column.Type) : null, nullable: column?.Null, default: column?.Default });
  }
  const pending = columns.filter((column) => column.type !== null && needsMillisecondPrecision(column.type));
  console.table(columns.map((column) => ({
    Tabel: column.table,
    'Tipe sekarang': column.type ?? 'tabel belum ada (dilewati)',
    Status: column.type === null ? '—' : needsMillisecondPrecision(column.type) ? `akan diubah ke ${MILLISECOND_COLUMN_DEFINITION}` : 'sudah milidetik',
  })));

  if (!pending.length) console.log('\nSemua kolom sudah presisi milidetik. Tidak ada yang perlu diubah.');
  else if (!apply) console.log(`\n${pending.length} kolom perlu diubah. Tidak ada yang diubah; jalankan dengan --apply setelah daftar di atas diperiksa dan database di-backup.`);
  else {
    for (const column of pending) {
      await pool.query(`ALTER TABLE \`${column.table}\` MODIFY COLUMN \`created_at\` ${MILLISECOND_COLUMN_DEFINITION}`);
      console.log(`${column.table}.created_at → ${MILLISECOND_COLUMN_DEFINITION}`);
    }
    console.log(`\n${pending.length} kolom diubah.`);
  }
} finally {
  await pool.end();
}
