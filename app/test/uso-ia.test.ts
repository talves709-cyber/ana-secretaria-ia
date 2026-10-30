import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Db } from '../src/db.js';
import { custoUsd, gastoDoMes, registrarUso, registrarUsoSeguro, situacaoLimite } from '../src/uso-ia.js';
import { iniciarBanco, limparBanco } from './apoio/banco.js';

const zero = { entrada: 0, saida: 0, cacheLeitura: 0, cacheEscrita: 0 };

describe('custoUsd e situacaoLimite', () => {
  it('calcula custo do haiku', () => {
    expect(custoUsd('claude-haiku-5-5', { ...zero, entrada: 1_000_000, saida: 1_000_000 })).toBeCloseTo(0.6);
  });
  it('soma cache de leitura e escrita', () => {
    expect(custoUsd('claude-sonnet-5-5', { ...zero, cacheLeitura: 1_000_000, cacheEscrita: 1_000_000 })).toBeCloseTo(4.2);
  });
  it('modelo desconhecido usa o preço do opus', () => {
    const u = { ...zero, entrada: 1_000_000, saida: 1_000_000 };
    expect(custoUsd('modelo-novo', u)).toBeCloseTo(custoUsd('claude-opus-5-5', u));
    expect(custoUsd('modelo-novo', u)).toBeCloseTo(24);
  });
  it('situacaoLimite', () => {
    expect(situacaoLimite(39.9, 50)).toBe('ok');
    expect(situacaoLimite(40, 50)).toBe('aviso');
    expect(situacaoLimite(49.9, 50)).toBe('aviso');
    expect(situacaoLimite(50, 50)).toBe('estourado');
  });
});

describe('registrarUso e gastoDoMes', () => {
  let db: Db;
  let parar: () => Promise<void>;
  beforeAll(async () => {
    ({ db, parar } = await iniciarBanco());
  });
  afterAll(async () => {
    await parar();
  });
  beforeEach(async () => {
    await limparBanco(db);
  });

  it('registrarUso grava tokens e custo', async () => {
    await registrarUso(db, 'triagem', 'claude-haiku-5-5', { ...zero, entrada: 1_000_000, saida: 1_000_000 });
    const r = await db.query(`SELECT agente, modelo, entrada, saida, custo_usd::float8 c FROM uso_ia`);
    expect(r.rows[0]).toMatchObject({ agente: 'triagem', modelo: 'claude-haiku-5-5', entrada: 1_000_000, saida: 1_000_000 });
    expect(r.rows[0].c).toBeCloseTo(0.6);
  });

  it('gastoDoMes soma só o mês corrente de São Paulo', async () => {
    const ins = (quando: string, custo: number) =>
      db.query(`INSERT INTO uso_ia (agente, modelo, custo_usd, criado_em) VALUES ('triagem','x',$1,$2)`, [custo, quando]);
    await ins('2026-09-30T23:30:00-03:00', 100); // setembro em SP: fora
    await ins('2026-10-01T00:10:00-03:00', 1.5); // outubro em SP: dentro
    await ins('2026-10-20T12:00:00-03:00', 2);
    await ins('2026-10-31T23:30:00-03:00', 0.5); // ainda outubro em SP (já é novembro em UTC)
    expect(await gastoDoMes(db, new Date('2026-10-25T15:00:00-03:00'))).toBeCloseTo(4);
  });

  it('gastoDoMes é 0 sem registros', async () => {
    expect(await gastoDoMes(db)).toBe(0);
  });
});

describe('registrarUsoSeguro', () => {
  it('não lança quando o INSERT falha', async () => {
    const erro = vi.spyOn(console, 'error').mockImplementation(() => {});
    const dbFalso = { query: vi.fn().mockRejectedValue(new Error('banco fora')) } as unknown as Db;
    await expect(registrarUsoSeguro(dbFalso, 'triagem', 'claude-haiku-5-5', zero)).resolves.toBeUndefined();
    expect(erro).toHaveBeenCalledOnce();
    erro.mockRestore();
  });
});
