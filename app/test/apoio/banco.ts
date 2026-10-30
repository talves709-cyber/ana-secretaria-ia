import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { inject } from 'vitest';
import { criarDb, type Db } from '../../src/db.js';
import { BANCO_MODELO } from './global.js';

// Tabelas semeadas pelas migrações (ou de controle delas): nunca são limpas.
// Atenção: bases_conhecimento é preservada, então versões criadas dentro de um teste vazam para os
// seguintes do mesmo arquivo; quem as cria deve removê-las ao final.
const PRESERVADAS = ['segmentos', 'empresas', 'negocios', 'categorias', 'bases_conhecimento', 'schema_migrations'];

async function comAdmin(porta: number, fn: (c: pg.Client) => Promise<void>) {
  const admin = new pg.Client({ connectionString: `postgres://postgres:postgres@127.0.0.1:${porta}/postgres` });
  await admin.connect();
  try {
    await fn(admin);
  } finally {
    await admin.end();
  }
}

/**
 * Cria um banco novo e exclusivo deste arquivo de teste, copiado do modelo já migrado que o
 * globalSetup preparou (um único Postgres por execução do vitest), e conecta nele.
 */
export async function iniciarBanco(): Promise<{ db: Db; parar(): Promise<void> }> {
  const porta = inject('pgPorta');
  const nome = `ana_t_${randomBytes(6).toString('hex')}`;
  await comAdmin(porta, async (c) => {
    await c.query(`CREATE DATABASE ${nome} TEMPLATE ${BANCO_MODELO}`);
  });
  const db = criarDb(`postgres://postgres:postgres@127.0.0.1:${porta}/${nome}`);
  return {
    db,
    async parar() {
      await db.end();
      await comAdmin(porta, async (c) => {
        await c.query(`DROP DATABASE IF EXISTS ${nome} WITH (FORCE)`);
      });
    },
  };
}

/** Esvazia as tabelas de dados (reiniciando as sequências), preservando o cadastro semeado pelas migrações. */
export async function limparBanco(db: Db): Promise<void> {
  const { rows } = await db.query<{ tablename: string }>(
    `SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> ALL($1::text[])`,
    [PRESERVADAS],
  );
  if (rows.length === 0) return;
  const lista = rows.map((r) => `"${r.tablename}"`).join(', ');
  await db.query(`TRUNCATE ${lista} RESTART IDENTITY CASCADE`);
}
