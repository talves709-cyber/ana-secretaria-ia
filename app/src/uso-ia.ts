import type { Db } from './db.js';

export interface UsoTokens {
  entrada: number;
  saida: number;
  cacheLeitura: number;
  cacheEscrita: number;
}

// US$ por milhão de tokens, preço de lista em 2026-10. cacheEscrita = escrita com TTL 1h (2x entrada).
export const PRECOS: Record<string, { entrada: number; saida: number; cacheLeitura: number; cacheEscrita: number }> = {
  'claude-haiku-5-5': { entrada: 0.1, saida: 0.5, cacheLeitura: 0.01, cacheEscrita: 0.2 },
  'claude-sonnet-5-5': { entrada: 2, saida: 10, cacheLeitura: 0.2, cacheEscrita: 4 },
  'claude-opus-5-5': { entrada: 4, saida: 20, cacheLeitura: 0.2, cacheEscrita: 8 },
};

export type AgenteIA = 'triagem' | 'especialista' | 'interprete';

/** Custo em US$. Modelo desconhecido usa o preço do opus (estimativa conservadora). */
export function custoUsd(modelo: string, u: UsoTokens): number {
  const p = PRECOS[modelo] ?? PRECOS['claude-opus-5-5']!;
  return (u.entrada * p.entrada + u.saida * p.saida + u.cacheLeitura * p.cacheLeitura + u.cacheEscrita * p.cacheEscrita) / 1_000_000;
}

export async function registrarUso(db: Db, agente: AgenteIA, modelo: string, u: UsoTokens): Promise<void> {
  await db.query(
    `INSERT INTO uso_ia (agente, modelo, entrada, saida, cache_leitura, cache_escrita, custo_usd)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [agente, modelo, u.entrada, u.saida, u.cacheLeitura, u.cacheEscrita, custoUsd(modelo, u)],
  );
}

/** Gasto em US$ no mês corrente, contado no fuso de São Paulo. */
export async function gastoDoMes(db: Db, agora: Date = new Date()): Promise<number> {
  const r = await db.query(
    `SELECT COALESCE(SUM(custo_usd), 0)::float8 AS total FROM uso_ia
      WHERE date_trunc('month', criado_em AT TIME ZONE 'America/Sao_Paulo')
          = date_trunc('month', $1::timestamptz AT TIME ZONE 'America/Sao_Paulo')`,
    [agora],
  );
  return Number(r.rows[0].total);
}

/** aviso a partir de 80% do limite; estourado a partir de 100%. */
export function situacaoLimite(gasto: number, limite: number): 'ok' | 'aviso' | 'estourado' {
  if (gasto >= limite) return 'estourado';
  if (gasto >= limite * 0.8) return 'aviso';
  return 'ok';
}
