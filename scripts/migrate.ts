import { criarDataSource } from '../src/infrastructure/database.ts';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('Defina DATABASE_URL antes de executar as migrações.');
const db = criarDataSource(url);
try {
  await db.initialize();
  const migracoes = await db.runMigrations({ transaction: 'all' });
  console.log(JSON.stringify({ migracoes: migracoes.map(m => m.name) }));
} finally {
  if (db.isInitialized) await db.destroy();
}
