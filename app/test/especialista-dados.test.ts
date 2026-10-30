import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '../src/db.js';
import { anexarItens, criarDemanda, garantirClienteDaConversa } from '../src/demandas.js';
import { baseDaEmpresa, carregarBloco, exemplosDaEmpresa } from '../src/especialista-dados.js';
import { iniciarBanco, limparBanco } from './apoio/banco.js';

let db: Db;
let parar: () => Promise<void>;
let empresaId: number;
let categoriaId: number;

beforeAll(async () => {
  ({ db, parar } = await iniciarBanco());
  empresaId = Number((await db.query(`SELECT id FROM empresas ORDER BY id LIMIT 1`)).rows[0].id);
  categoriaId = Number((await db.query(`SELECT id FROM categorias ORDER BY id LIMIT 1`)).rows[0].id);
});
afterAll(async () => {
  await parar();
});
beforeEach(async () => {
  await limparBanco(db);
});

async function conversa(): Promise<number> {
  const r = await db.query(`INSERT INTO conversas (jid, tipo, nome) VALUES ('c1@s.whatsapp.net', 'individual', 'Cliente A') RETURNING id`);
  return Number(r.rows[0].id);
}

let seq = 0;
async function mensagem(conversaId: number, texto: string | null, minutos: number, classificar = true, prioridade = 'media'): Promise<number> {
  seq += 1;
  const r = await db.query(
    `INSERT INTO mensagens (conversa_id, whatsapp_msg_id, tipo, texto, de_mim, recebida_em)
     VALUES ($1, $2, 'conversation', $3, false, '2026-10-30T12:00:00Z'::timestamptz + ($4 || ' minutes')::interval) RETURNING id`,
    [conversaId, `w${seq}`, texto, String(minutos)],
  );
  const id = Number(r.rows[0].id);
  if (classificar) {
    await db.query(
      `INSERT INTO classificacoes (mensagem_id, empresa_id, categoria_id, prioridade, resumo, acao_sugerida)
       VALUES ($1, $2, $3, $4, $5, 'responder')`,
      [id, empresaId, categoriaId, prioridade, `resumo ${id}`],
    );
  }
  return id;
}

describe('carregarBloco', () => {
  it('devolve só mensagens classificadas sem item, com contexto e a classificação da mais recente', async () => {
    const c = await conversa();
    const antiga = await mensagem(c, 'antiga', 0);
    await mensagem(c, 'sem classificar', 5, false);
    const feita = await mensagem(c, 'já analisada', 10);
    const n1 = await mensagem(c, 'nova um', 20, true, 'media');
    const n2 = await mensagem(c, 'nova dois', 21, true, 'urgente');
    await anexarItens(db, null, [antiga, feita]);

    const b = await carregarBloco(db, c);
    expect(b).not.toBeNull();
    expect(b!.mensagens.map((m) => m.id)).toEqual([n1, n2]);
    expect(b!.prioridade).toBe('urgente');
    expect(b!.resumo).toBe(`resumo ${n2}`);
    expect(b!.empresaId).toBe(empresaId);
    expect(b!.categoriaId).toBe(categoriaId);
    expect(b!.conversaJid).toBe('c1@s.whatsapp.net');
    expect(b!.contexto.map((m) => m.texto)).toEqual(['antiga', 'sem classificar', 'já analisada']);
  });

  it('devolve null sem mensagens a analisar ou conversa inexistente', async () => {
    const c = await conversa();
    expect(await carregarBloco(db, c)).toBeNull();
    const m = await mensagem(c, 'x', 1);
    const cliente = await garantirClienteDaConversa(db, c);
    const d = await criarDemanda(db, {
      clienteId: cliente, conversaId: c, empresaId: null, categoriaId: null, titulo: 't', plano: null,
      prazo: null, prazoTemHora: false, etapaSugerida: null, prioridade: 'media',
    });
    await anexarItens(db, d.id, [m]);
    expect(await carregarBloco(db, c)).toBeNull();
    expect(await carregarBloco(db, 99999)).toBeNull();
  });
});

describe('baseDaEmpresa e exemplosDaEmpresa', () => {
  it('baseDaEmpresa devolve a última versão', async () => {
    try {
      await db.query(`INSERT INTO bases_conhecimento (empresa_id, versao, texto) VALUES ($1, 2, 'versão dois'), ($1, 3, 'versão três')`, [empresaId]);
      expect(await baseDaEmpresa(db, empresaId)).toBe('versão três');
      expect(await baseDaEmpresa(db, null)).toBe('');
    } finally {
      await db.query(`DELETE FROM bases_conhecimento WHERE empresa_id = $1 AND versao > 1`, [empresaId]);
    }
  });

  it('exemplosDaEmpresa respeita empresa e limite, mais recentes primeiro', async () => {
    for (let i = 1; i <= 7; i++) {
      await db.query(`INSERT INTO exemplos_estilo (empresa_id, antes, depois) VALUES ($1, $2, $3)`, [empresaId, `a${i}`, `d${i}`]);
    }
    await db.query(`INSERT INTO exemplos_estilo (empresa_id, antes, depois) VALUES (NULL, 'x', 'y')`);
    const r = await exemplosDaEmpresa(db, empresaId);
    expect(r).toHaveLength(5);
    expect(r[0]).toEqual({ antes: 'a7', depois: 'd7' });
    expect(await exemplosDaEmpresa(db, empresaId, 2)).toHaveLength(2);
    expect(await exemplosDaEmpresa(db, null)).toEqual([]);
  });
});
