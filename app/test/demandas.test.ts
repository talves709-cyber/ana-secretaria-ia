import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '../src/db.js';
import {
  anexarItens,
  atualizarDemanda,
  buscarDemanda,
  criarDemanda,
  demandasAbertasDaConversa,
  garantirClienteDaConversa,
  mudarEtapa,
  rascunhoAtual,
  salvarRascunho,
  type NovaDemanda,
} from '../src/demandas.js';
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

async function novaConversa(jid = 'conversa-a@s.whatsapp.net', nome: string | null = 'Conversa A'): Promise<number> {
  const r = await db.query(`INSERT INTO conversas (jid, tipo, nome) VALUES ($1, 'individual', $2) RETURNING id`, [jid, nome]);
  return Number(r.rows[0].id);
}

async function nova(conversaId: number, titulo = 'Pedido'): Promise<NovaDemanda> {
  const clienteId = await garantirClienteDaConversa(db, conversaId);
  return {
    clienteId,
    conversaId,
    empresaId: null,
    categoriaId: null,
    titulo,
    plano: null,
    prazo: null,
    prazoTemHora: false,
    etapaSugerida: null,
    prioridade: 'media',
  };
}

describe('garantirClienteDaConversa', () => {
  it('cria um cliente por conversa e reaproveita na segunda chamada', async () => {
    const conversa = await novaConversa();
    const a = await garantirClienteDaConversa(db, conversa);
    const b = await garantirClienteDaConversa(db, conversa);
    expect(b).toBe(a);
    const n = await db.query(`SELECT count(*)::int n FROM clientes`);
    expect(n.rows[0].n).toBe(1);
    const c = await db.query(`SELECT nome FROM clientes WHERE id = $1`, [a]);
    expect(c.rows[0].nome).toBe('Conversa A');
  });

  it('usa o nome do contato e, na falta, o jid', async () => {
    const contato = await db.query(`INSERT INTO contatos (jid, nome) VALUES ('c1@s.whatsapp.net', 'Nome do contato') RETURNING id`);
    const r1 = await db.query(
      `INSERT INTO conversas (jid, tipo, contato_id) VALUES ('c1@s.whatsapp.net', 'individual', $1) RETURNING id`,
      [contato.rows[0].id],
    );
    const r2 = await db.query(`INSERT INTO conversas (jid, tipo) VALUES ('c2@s.whatsapp.net', 'individual') RETURNING id`);
    const a = await garantirClienteDaConversa(db, Number(r1.rows[0].id));
    const b = await garantirClienteDaConversa(db, Number(r2.rows[0].id));
    const nomes = await db.query(`SELECT id, nome FROM clientes`);
    const porId = new Map(nomes.rows.map((x) => [Number(x.id), x.nome]));
    expect(porId.get(a)).toBe('Nome do contato');
    expect(porId.get(b)).toBe('c2@s.whatsapp.net');
  });

  it('conversas diferentes geram clientes diferentes (nunca mescla)', async () => {
    const a = await garantirClienteDaConversa(db, await novaConversa('a@s.whatsapp.net'));
    const b = await garantirClienteDaConversa(db, await novaConversa('b@s.whatsapp.net'));
    expect(a).not.toBe(b);
  });

  it('falha se a conversa não existe', async () => {
    await expect(garantirClienteDaConversa(db, 999)).rejects.toThrow(/conversa/i);
  });
});

describe('demandas', () => {
  it('criarDemanda começa em novo e registra o histórico', async () => {
    const conversa = await novaConversa();
    const d = await criarDemanda(db, await nova(conversa));
    expect(d.etapa).toBe('novo');
    expect(d.titulo).toBe('Pedido');
    expect(d.avisadaEm).toBeNull();
    const h = await db.query(`SELECT de, para, autor FROM demanda_etapas WHERE demanda_id = $1`, [d.id]);
    expect(h.rows).toEqual([{ de: null, para: 'novo', autor: 'agente' }]);
  });

  it('mudarEtapa grava de/para/autor/motivo e atualiza etapa_desde', async () => {
    const d = await criarDemanda(db, await nova(await novaConversa()));
    await db.query(`UPDATE demandas SET etapa_desde = now() - interval '2 days' WHERE id = $1`, [d.id]);
    await mudarEtapa(db, d.id, 'comigo', 'thiago', 'vou fazer');
    const depois = await buscarDemanda(db, d.id);
    expect(depois?.etapa).toBe('comigo');
    expect(Date.now() - depois!.etapaDesde.getTime()).toBeLessThan(60_000);
    const h = await db.query(`SELECT de, para, autor, motivo FROM demanda_etapas WHERE demanda_id = $1 ORDER BY id`, [d.id]);
    expect(h.rows[1]).toEqual({ de: 'novo', para: 'comigo', autor: 'thiago', motivo: 'vou fazer' });
  });

  it('mudarEtapa para a mesma etapa não grava histórico', async () => {
    const d = await criarDemanda(db, await nova(await novaConversa()));
    await mudarEtapa(db, d.id, 'novo', 'ana', 'nada');
    const h = await db.query(`SELECT count(*)::int n FROM demanda_etapas WHERE demanda_id = $1`, [d.id]);
    expect(h.rows[0].n).toBe(1);
  });

  it('atualizarDemanda altera só os campos informados', async () => {
    const d = await criarDemanda(db, await nova(await novaConversa()));
    const prazo = new Date('2026-11-05T15:00:00Z');
    await atualizarDemanda(db, d.id, { plano: 'Passo 1', prazo, prazoTemHora: true, prioridade: 'alta', etapaSugerida: 'agendar' });
    await atualizarDemanda(db, d.id, {});
    const x = await buscarDemanda(db, d.id);
    expect(x).toMatchObject({ titulo: 'Pedido', plano: 'Passo 1', prazoTemHora: true, prioridade: 'alta', etapaSugerida: 'agendar' });
    expect(x?.prazo?.toISOString()).toBe(prazo.toISOString());
  });

  it('buscarDemanda devolve null quando não existe', async () => {
    expect(await buscarDemanda(db, 12345)).toBeNull();
  });

  it('demandasAbertasDaConversa ignora concluídas, ordena por mais recentes e limita a 5', async () => {
    const conversa = await novaConversa();
    const outra = await novaConversa('outra@s.whatsapp.net', 'Outra');
    const ids: number[] = [];
    for (let i = 0; i < 7; i++) ids.push((await criarDemanda(db, await nova(conversa, `D${i}`))).id);
    await criarDemanda(db, await nova(outra, 'Da outra'));
    await mudarEtapa(db, ids[6], 'concluido', 'thiago', 'feito');
    const lista = await demandasAbertasDaConversa(db, conversa);
    expect(lista.map((d) => d.titulo)).toEqual(['D5', 'D4', 'D3', 'D2', 'D1']);
  });

  it('anexarItens ignora mensagem já anexada e aceita demanda nula', async () => {
    const conversa = await novaConversa();
    const d1 = await criarDemanda(db, await nova(conversa, 'A'));
    const d2 = await criarDemanda(db, await nova(conversa, 'B'));
    const m = await db.query(
      `INSERT INTO mensagens (whatsapp_msg_id, conversa_id, de_mim, tipo, texto, recebida_em)
       VALUES ('w1', $1, false, 'texto', 'oi', now()), ('w2', $1, false, 'texto', 'ola', now()) RETURNING id`,
      [conversa],
    );
    const [m1, m2] = m.rows.map((r) => Number(r.id));
    await anexarItens(db, d1.id, [m1]);
    await anexarItens(db, d2.id, [m1, m2]);
    await anexarItens(db, null, []);
    const r = await db.query(`SELECT mensagem_id, demanda_id FROM demanda_itens ORDER BY mensagem_id`);
    expect(r.rows.map((x) => [Number(x.mensagem_id), Number(x.demanda_id)])).toEqual([
      [m1, d1.id],
      [m2, d2.id],
    ]);
    const m3 = await db.query(
      `INSERT INTO mensagens (whatsapp_msg_id, conversa_id, de_mim, tipo, recebida_em) VALUES ('w3', $1, false, 'texto', now()) RETURNING id`,
      [conversa],
    );
    await anexarItens(db, null, [Number(m3.rows[0].id)]);
    const nulo = await db.query(`SELECT demanda_id FROM demanda_itens WHERE mensagem_id = $1`, [m3.rows[0].id]);
    expect(nulo.rows[0].demanda_id).toBeNull();
  });
});

describe('rascunhos', () => {
  it('salvarRascunho incrementa versão e muda o hash quando muda o texto', async () => {
    const d = await criarDemanda(db, await nova(await novaConversa()));
    const r1 = await salvarRascunho(db, d.id, 'Olá', 'destino-a');
    const r2 = await salvarRascunho(db, d.id, 'Olá, tudo bem?', 'destino-a');
    expect([r1.versao, r2.versao]).toEqual([1, 2]);
    expect(r1.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(r2.hash).not.toBe(r1.hash);
    const mesmo = await salvarRascunho(db, d.id, 'Olá', 'destino-a');
    expect(mesmo.hash).toBe(r1.hash);
    const outroDestino = await salvarRascunho(db, d.id, 'Olá', 'destino-b');
    expect(outroDestino.hash).not.toBe(r1.hash);
  });

  it('rascunhoAtual devolve a maior versão, ou null sem rascunhos', async () => {
    const d = await criarDemanda(db, await nova(await novaConversa()));
    expect(await rascunhoAtual(db, d.id)).toBeNull();
    await salvarRascunho(db, d.id, 'v1', 'x');
    await salvarRascunho(db, d.id, 'v2', 'x');
    const atual = await rascunhoAtual(db, d.id);
    expect(atual).toMatchObject({ versao: 2, texto: 'v2', destino: 'x', demandaId: d.id });
  });

  it('versões concorrentes não colidem', async () => {
    const d = await criarDemanda(db, await nova(await novaConversa()));
    const rs = await Promise.all([1, 2, 3, 4].map((i) => salvarRascunho(db, d.id, `t${i}`, 'x')));
    expect(rs.map((r) => r.versao).sort()).toEqual([1, 2, 3, 4]);
  });
});
