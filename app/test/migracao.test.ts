import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '../src/db.js';
import { carregarBloco } from '../src/especialista-dados.js';
import { iniciarBanco, limparBanco } from './apoio/banco.js';

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

async function novoCliente(): Promise<number> {
  const r = await db.query(`INSERT INTO clientes (nome) VALUES ('Cliente de teste') RETURNING id`);
  return Number(r.rows[0].id);
}

describe('migração 003', () => {
  it('aplica 001–003 e semeia uma base por empresa', async () => {
    const r = await db.query(`SELECT count(*)::int n FROM bases_conhecimento WHERE versao = 1`);
    const e = await db.query(`SELECT count(*)::int n FROM empresas`);
    expect(e.rows[0].n).toBeGreaterThan(0);
    expect(r.rows[0].n).toBe(e.rows[0].n);
  });

  it('aceita modo comando em conversas e recusa valor inválido', async () => {
    await db.query(`INSERT INTO conversas (jid, tipo, modo) VALUES ('x@s.whatsapp.net','individual','comando')`);
    await expect(
      db.query(`INSERT INTO conversas (jid, tipo, modo) VALUES ('z@s.whatsapp.net','individual','xyz')`),
    ).rejects.toThrow(/conversas_modo_check/);
  });

  it.each(['novo', 'comigo', 'aguardando_terceiro', 'agendado', 'concluido'])('aceita a etapa %s', async (etapa) => {
    const cliente = await novoCliente();
    await db.query(`INSERT INTO demandas (cliente_id, titulo, etapa, prioridade) VALUES ($1,'t',$2,'baixa')`, [
      cliente,
      etapa,
    ]);
  });

  it('usa a etapa novo por padrão', async () => {
    const cliente = await novoCliente();
    const r = await db.query(
      `INSERT INTO demandas (cliente_id, titulo, prioridade) VALUES ($1,'t','media') RETURNING etapa`,
      [cliente],
    );
    expect(r.rows[0].etapa).toBe('novo');
  });

  it('recusa etapa fora da lista', async () => {
    const cliente = await novoCliente();
    await expect(
      db.query(`INSERT INTO demandas (cliente_id, titulo, etapa, prioridade) VALUES ($1,'t','perdida','baixa')`, [
        cliente,
      ]),
    ).rejects.toThrow(/demandas_etapa_check/);
  });

  it('recusa prioridade fora da lista', async () => {
    const cliente = await novoCliente();
    await expect(
      db.query(`INSERT INTO demandas (cliente_id, titulo, prioridade) VALUES ($1,'t','critica')`, [cliente]),
    ).rejects.toThrow(/demandas_prioridade_check/);
  });

  it('limparBanco esvazia dados, reinicia ids e preserva o cadastro', async () => {
    await db.query(`INSERT INTO clientes (nome) VALUES ('A')`);
    await db.query(`INSERT INTO conversas (jid, tipo) VALUES ('y@s.whatsapp.net','individual')`);
    await limparBanco(db);
    expect((await db.query(`SELECT count(*)::int n FROM clientes`)).rows[0].n).toBe(0);
    expect((await db.query(`SELECT count(*)::int n FROM conversas`)).rows[0].n).toBe(0);
    const novo = await db.query(`INSERT INTO clientes (nome) VALUES ('B') RETURNING id`);
    expect(Number(novo.rows[0].id)).toBe(1);
    expect((await db.query(`SELECT count(*)::int n FROM empresas`)).rows[0].n).toBeGreaterThan(0);
    expect((await db.query(`SELECT count(*)::int n FROM bases_conhecimento`)).rows[0].n).toBeGreaterThan(0);
  });

  it('mensagem classificada que já existia antes da 003 conta como vista: o especialista não a analisa', async () => {
    const conv = await db.query(`INSERT INTO conversas (jid, tipo, nome) VALUES ('h@s.whatsapp.net','individual','H') RETURNING id`);
    const conversaId = Number(conv.rows[0].id);
    const m = await db.query(
      `INSERT INTO mensagens (conversa_id, whatsapp_msg_id, tipo, texto, de_mim, recebida_em)
       VALUES ($1, 'antiga', 'conversation', 'pedido antigo', false, now()) RETURNING id`,
      [conversaId],
    );
    await db.query(
      `INSERT INTO classificacoes (mensagem_id, prioridade, resumo, acao_sugerida) VALUES ($1, 'media', 'r', 'responder')`,
      [Number(m.rows[0].id)],
    );
    expect(await carregarBloco(db, conversaId)).not.toBeNull();

    // O modelo de testes já migrou tudo: reaplica o mesmo comando da 003 sobre o histórico inserido acima.
    const sql = readFileSync(new URL('../migrations/003_demandas.sql', import.meta.url), 'utf8');
    const preenche = sql.split(/\r?\n/).find((l) => l.startsWith('INSERT INTO demanda_itens'));
    expect(preenche).toBeDefined();
    await db.query(preenche!);
    // Rodar de novo não duplica nem falha.
    await db.query(preenche!);

    expect(await carregarBloco(db, conversaId)).toBeNull();
    const itens = await db.query(`SELECT demanda_id FROM demanda_itens`);
    expect(itens.rows).toEqual([{ demanda_id: null }]);
  });
});
