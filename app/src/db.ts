import pg from 'pg';

export type Db = pg.Pool;

export function criarDb(url: string): Db {
  return new pg.Pool({ connectionString: url, max: 10 });
}
