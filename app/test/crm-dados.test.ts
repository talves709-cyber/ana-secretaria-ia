import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '../src/db.js';
import { bases, fichaCliente, quadro, salvarBase } from '../src/crm-dados.js';
import { criarDemanda, garantirClienteDaConversa, mudarEtapa, salvarRascunho } from '../src/demandas.js';
import { iniciarBanco, limparBanco } from './apoio/banco.js';

let db: Db;
let parar: () => Promise<void>;
const AGORA = new Date('2026-10-27T15:00:00Z');

beforeAll(async () => {
  ({ db, parar } = await iniciarBanco());
});
afterAll(async () => {
  await parar();
});
beforeEach(async () => {
  await limparBanco(db);
  // bases_conhecimento é preservada pelo limparBanco: remove as versões criadas por testes anteriores.
  await db.query(`DELETE FROM bases_conhecimento WHERE versao > 1`);
});

async function primeiraEmpresa(excluir?: number): Promise<number> {
  const r = await db.query(`SELECT id FROM empresas WHERE id <> $1 ORDER BY id LIMIT 1`, [excluir ?? 0]);
  return Number(r.rows[0].id);
}

async function nova(jid: string, titulo: string, empresa: number | null, extra: { etapa?: string; desde?: string } = {}) {
  const conv = await db.query(`INSERT INTO conversas (jid, tipo, nome) VALUES ($1, 'individual', $2) RETURNING id`, [jid, `Cli ${jid}`]);
  const conversaId = Number(conv.rows[0].id);
  const clienteId = await garantirClienteDaConversa(db, conversaId);
  const d = await criarDemanda(db, {
    clienteId,
    conversaId,
    empresaId: empresa,
    categoriaId: null,
    titulo,
    plano: null,
    prazo: null,
    prazoTemHora: false,
    etapaSugerida: null,
    prioridade: 'media',
  });
  if (extra.etapa) await db.query(`UPDATE demandas SET etapa = $2 WHERE id = $1`, [d.id, extra.etapa]);
  if (extra.desde) await db.query(`UPDATE demandas SET etapa_desde = $2 WHERE id = $1`, [d.id, extra.desde]);
  return { id: d.id, clienteId };
}

describe('quadro', () => {
  it('filtra por empresa e esconde concluídas antigas', async () => {
    const e1 = await primeiraEmpresa();
    const e2 = await primeiraEmpresa(e1);
    await nova('a@s.whatsapp.net', 'da empresa 1', e1);
    await nova('b@s.whatsapp.net', 'da empresa 2', e2);
    await nova('c@s.whatsapp.net', 'concluida velha', e1, { etapa: 'concluido', desde: '2026-10-10T00:00:00Z' });
    await nova('d@s.whatsapp.net', 'concluida recente', e1, { etapa: 'concluido', desde: '2026-10-25T00:00:00Z' });

    const todas = (await quadro(db, {}, AGORA)).map((c) => c.titulo).sort();
    expect(todas).toEqual(['concluida recente', 'da empresa 1', 'da empresa 2']);
    const so1 = await quadro(db, { empresaId: e1 }, AGORA);
    expect(so1.map((c) => c.titulo).sort()).toEqual(['concluida recente', 'da empresa 1']);
    expect(so1[0].empresa).not.toBeNull();
  });

  it('filtra por cliente e traz a resposta mais recente', async () => {
    const a = await nova('a@s.whatsapp.net', 'A', null);
    await nova('b@s.whatsapp.net', 'B', null);
    await salvarRascunho(db, a.id, 'primeira', 'a@s.whatsapp.net');
    await salvarRascunho(db, a.id, 'segunda', 'a@s.whatsapp.net');
    const r = await quadro(db, { clienteId: a.clienteId }, AGORA);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ id: a.id, resposta: 'segunda', etapa: 'novo', clienteId: a.clienteId });
  });

  it('ordena urgentes primeiro', async () => {
    const a = await nova('a@s.whatsapp.net', 'normal', null);
    const b = await nova('b@s.whatsapp.net', 'urgente', null);
    await db.query(`UPDATE demandas SET prioridade = 'urgente' WHERE id = $1`, [b.id]);
    expect((await quadro(db, {}, AGORA)).map((c) => c.id)).toEqual([b.id, a.id]);
  });
});

describe('fichaCliente', () => {
  it('traz contatos e demandas; null se não existe', async () => {
    const a = await nova('a@s.whatsapp.net', 'A', null);
    await mudarEtapa(db, a.id, 'comigo', 'thiago', 'teste');
    const f = await fichaCliente(db, a.clienteId);
    expect(f?.contatos).toEqual(['a@s.whatsapp.net']);
    expect(f?.demandas.map((d) => [d.id, d.etapa])).toEqual([[a.id, 'comigo']]);
    expect(await fichaCliente(db, 999999)).toBeNull();
  });
});

describe('bases', () => {
  it('salvarBase cria a versão 2 e bases() devolve a mais recente', async () => {
    const e = await primeiraEmpresa();
    await salvarBase(db, e, 'novo texto da base');
    const v = await db.query(`SELECT versao FROM bases_conhecimento WHERE empresa_id = $1 ORDER BY versao`, [e]);
    expect(v.rows.map((x) => x.versao)).toEqual([1, 2]);
    const b = (await bases(db)).find((x) => x.empresaId === e);
    expect(b).toMatchObject({ versao: 2, texto: 'novo texto da base' });
  });

  it('texto igual ao da versão atual não cria versão', async () => {
    const e = await primeiraEmpresa();
    await salvarBase(db, e, 'igual');
    await salvarBase(db, e, 'igual');
    const v = await db.query(`SELECT count(*)::int AS n FROM bases_conhecimento WHERE empresa_id = $1`, [e]);
    expect(v.rows[0].n).toBe(2);
  });
});
