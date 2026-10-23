import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { criarDb, type Db } from './db.js';

const PASTA = path.resolve(process.cwd(), 'migrations');

/** Aplica, em ordem, as migrações de migrations/ que ainda não rodaram. */
export async function migrar(db: Db): Promise<string[]> {
  await db.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    nome text PRIMARY KEY, aplicada_em timestamptz NOT NULL DEFAULT now())`);
  const aplicadas = new Set(
    (await db.query<{ nome: string }>('SELECT nome FROM schema_migrations')).rows.map((r) => r.nome),
  );
  const arquivos = (await readdir(PASTA)).filter((f) => f.endsWith('.sql')).sort();
  const novas: string[] = [];
  for (const arquivo of arquivos) {
    if (aplicadas.has(arquivo)) continue;
    const sql = await readFile(path.join(PASTA, arquivo), 'utf8');
    const cliente = await db.connect();
    try {
      await cliente.query('BEGIN');
      await cliente.query(sql);
      await cliente.query('INSERT INTO schema_migrations (nome) VALUES ($1)', [arquivo]);
      await cliente.query('COMMIT');
      novas.push(arquivo);
    } catch (erro) {
      await cliente.query('ROLLBACK');
      throw new Error(`Falha na migração ${arquivo}: ${(erro as Error).message}`);
    } finally {
      cliente.release();
    }
  }
  return novas;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const db = criarDb(process.env.DATABASE_URL ?? '');
  migrar(db)
    .then((novas) => console.log(novas.length ? `Aplicadas: ${novas.join(', ')}` : 'Nada a migrar'))
    .finally(() => db.end());
}
