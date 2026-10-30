import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { avisarUrgente, cicloAna, formatarPacote, type DepsAna, type ItemPacote } from '../src/ana.js';
import type { Db } from '../src/db.js';
import { transacaoDoEspecialista } from '../src/especialista-dados.js';
import { iniciarBanco, limparBanco } from './apoio/banco.js';

let db: Db;
let parar: () => Promise<void>;
let enviadas: string[];

const DIA_UTIL = new Date('2026-10-27T15:00:00Z'); // terça 12:00 SP
const NOITE = new Date('2026-10-27T23:00:00Z'); // terça 20:00 SP

beforeAll(async () => {
  ({ db, parar } = await iniciarBanco());
});
afterAll(async () => {
  await parar();
});
beforeEach(async () => {
  await limparBanco(db);
  enviadas = [];
});

function deps(agora = DIA_UTIL, extra: Partial<DepsAna> = {}): DepsAna {
  return { db, enviar: async (t) => void enviadas.push(t), limiteMensalUsd: 50, agora: () => agora, ...extra };
}

const falha = (msg: string) => async () => {
  throw new Error(msg);
};

let seq = 0;
async function demanda(
  o: { titulo?: string; prioridade?: string; etapa?: string; sugerida?: string | null; criado?: string; empresa?: string | null } = {},
): Promise<number> {
  seq += 1;
  const c = await db.query(`INSERT INTO clientes (nome) VALUES ($1) RETURNING id`, [`Cliente ${seq}`]);
  const emp = o.empresa ? ((await db.query(`SELECT id FROM empresas WHERE nome = $1`, [o.empresa])).rows[0]?.id ?? null) : null;
  const r = await db.query(
    `INSERT INTO demandas (cliente_id, empresa_id, titulo, prioridade, etapa, etapa_sugerida, criado_em)
     VALUES ($1,$2,$3,$4,$5,$6,COALESCE($7::timestamptz, now())) RETURNING id`,
    [c.rows[0].id, emp, o.titulo ?? `Pedido ${seq}`, o.prioridade ?? 'media', o.etapa ?? 'novo', o.sugerida ?? null, o.criado ?? null],
  );
  return Number(r.rows[0].id);
}

const item = (o: Partial<ItemPacote> = {}): ItemPacote => ({
  id: 14,
  empresa: 'Kamex',
  cliente: 'Cliente X',
  titulo: 'Proforma do pedido 530.',
  etapa: 'novo',
  etapaSugerida: 'concluir',
  resposta: 'Bom dia, segue...',
  prioridade: 'media',
  ...o,
});

describe('formatarPacote', () => {
  it('segue o formato', () => {
    const texto = formatarPacote([
      item(),
      item({ id: 15, empresa: 'WTA', cliente: 'Grupo Y', titulo: 'Outro', etapaSugerida: null, resposta: null }),
    ]);
    expect(texto).toBe(
      [
        'Ana: 2 pedidos novos ou com novidade',
        '',
        '#14 Kamex · Cliente X',
        'Proforma do pedido 530.',
        'Sugiro: responder e concluir.',
        'Resposta: "Bom dia, segue..."',
        '',
        '#15 WTA · Grupo Y',
        'Outro',
        '',
        'Responda: ok 14 · 14 aguardar · 14 comigo · 14 agenda quinta 15h · 14 muda: novo texto',
      ].join('\n'),
    );
  });

  it('usa singular, omite empresa nula e rotula as sugestões', () => {
    const texto = formatarPacote([item({ empresa: null, etapaSugerida: 'aguardar' })]);
    expect(texto).toContain('Ana: 1 pedido novo ou com novidade\n');
    expect(texto).toContain('#14 Cliente X\n');
    expect(texto).toContain('Sugiro: responder e aguardar retorno.');
    expect(formatarPacote([item({ etapaSugerida: 'agendar' })])).toContain('Sugiro: agendar.');
    expect(formatarPacote([item({ etapaSugerida: 'comigo' })])).toContain('Sugiro: fica com você.');
  });

  it('leva a resposta inteira, sem cortar', () => {
    const longa = `${'a'.repeat(400)} fim`;
    expect(formatarPacote([item({ resposta: longa })])).toContain(`Resposta: "${longa}"`);
  });

  it('marca com (novidade) o item que não está em novo', () => {
    const texto = formatarPacote([item(), item({ id: 15, etapa: 'comigo' })]);
    expect(texto).toContain('#14 Kamex · Cliente X\n');
    expect(texto).toContain('#15 (novidade) Kamex · Cliente X\n');
  });
});

describe('cicloAna', () => {
  it('não envia nada no silêncio', async () => {
    await demanda();
    expect(await cicloAna(deps(NOITE))).toBe(0);
    expect(enviadas).toEqual([]);
    expect((await db.query(`SELECT avisada_em FROM demandas`)).rows[0].avisada_em).toBeNull();
  });

  it('envia no máximo 5 e marca avisada_em; o ciclo seguinte pega o resto', async () => {
    for (let i = 0; i < 7; i++) await demanda();
    expect(await cicloAna(deps())).toBe(5);
    expect(enviadas).toHaveLength(1);
    expect(enviadas[0]).toContain('Ana: 5 pedidos novos');
    const sem = await db.query(`SELECT count(*)::int n FROM demandas WHERE avisada_em IS NULL`);
    expect(sem.rows[0].n).toBe(2);
    expect(await cicloAna(deps())).toBe(2);
    expect(enviadas[1]).toContain('Ana: 2 pedidos novos');
    expect(await cicloAna(deps())).toBe(0);
    expect(enviadas).toHaveLength(2);
  });

  it('ordena por prioridade e depois por criação, e deixa de fora concluídas e já avisadas', async () => {
    const baixa = await demanda({ prioridade: 'baixa', criado: '2026-10-20T10:00:00Z' });
    const mediaVelha = await demanda({ prioridade: 'media', criado: '2026-10-21T10:00:00Z' });
    const mediaNova = await demanda({ prioridade: 'media', criado: '2026-10-22T10:00:00Z' });
    const urgente = await demanda({ prioridade: 'urgente', criado: '2026-10-25T10:00:00Z' });
    const alta = await demanda({ prioridade: 'alta', criado: '2026-10-24T10:00:00Z' });
    await demanda({ etapa: 'concluido', prioridade: 'urgente' });
    const avisada = await demanda({ etapa: 'comigo', prioridade: 'urgente' });
    await db.query(`UPDATE demandas SET avisada_em = now() WHERE id = $1`, [avisada]);
    await cicloAna(deps());
    const t = enviadas[0]!;
    const pos = [urgente, alta, mediaVelha, mediaNova, baixa].map((id) => t.indexOf(`#${id} `));
    expect(pos.every((p) => p >= 0)).toBe(true);
    expect([...pos].sort((a, b) => a - b)).toEqual(pos);
    expect(t).toContain('Ana: 5 pedidos novos');
  });

  it('inclui empresa, sugestão e o último rascunho', async () => {
    const id = await demanda({ empresa: 'KAMEX', sugerida: 'concluir', titulo: 'Proforma' });
    await db.query(
      `INSERT INTO rascunhos (demanda_id, versao, texto, destino, hash) VALUES ($1,1,'velho','d','h1'),($1,2,'Texto novo','d','h2')`,
      [id],
    );
    await cicloAna(deps());
    expect(enviadas[0]).toMatch(/Sugiro: responder e concluir\./);
    expect(enviadas[0]).toContain('Resposta: "Texto novo"');
    expect(enviadas[0]).not.toContain('velho');
  });

  it('se o envio falha, devolve a reserva e a marca de mostrado, e relança', async () => {
    const id = await demanda();
    await db.query(`INSERT INTO rascunhos (demanda_id, versao, texto, destino, hash) VALUES ($1,1,'t','d','h')`, [id]);
    await expect(cicloAna(deps(DIA_UTIL, { enviar: falha('evolution fora') }))).rejects.toThrow('evolution fora');
    expect((await db.query(`SELECT avisada_em FROM demandas`)).rows[0].avisada_em).toBeNull();
    expect((await db.query(`SELECT mostrado_em FROM rascunhos`)).rows[0].mostrado_em).toBeNull();
    expect(await cicloAna(deps())).toBe(1);
    expect((await db.query(`SELECT mostrado_em FROM rascunhos`)).rows[0].mostrado_em).not.toBeNull();
  });

  it('marca como mostrado só o rascunho atual que foi no pacote', async () => {
    const id = await demanda();
    await db.query(
      `INSERT INTO rascunhos (demanda_id, versao, texto, destino, hash) VALUES ($1,1,'velho','d','h1'),($1,2,'atual','d','h2')`,
      [id],
    );
    await cicloAna(deps());
    const r = await db.query(`SELECT versao, mostrado_em FROM rascunhos ORDER BY versao`);
    expect(r.rows[0].mostrado_em).toBeNull();
    expect(r.rows[1].mostrado_em).not.toBeNull();
  });

  it('resposta nova do especialista numa demanda já avisada em comigo volta no pacote como novidade', async () => {
    const conv = await db.query(`INSERT INTO conversas (jid, tipo) VALUES ('c@s.whatsapp.net','individual') RETURNING id`);
    const id = await demanda({ etapa: 'comigo', titulo: 'Frete' });
    await db.query(`UPDATE demandas SET conversa_id = $2 WHERE id = $1`, [id, conv.rows[0].id]);
    await db.query(`INSERT INTO rascunhos (demanda_id, versao, texto, destino, hash) VALUES ($1,1,'v1','c@s.whatsapp.net','h')`, [id]);
    expect(await cicloAna(deps())).toBe(1);
    expect(await cicloAna(deps())).toBe(0);

    await transacaoDoEspecialista(db, (e) => e.salvarRascunho(id, 'texto da v2', 'c@s.whatsapp.net'));
    expect((await db.query(`SELECT avisada_em FROM demandas WHERE id = $1`, [id])).rows[0].avisada_em).toBeNull();

    expect(await cicloAna(deps())).toBe(1);
    expect(enviadas[1]).toContain(`#${id} (novidade) `);
    expect(enviadas[1]).toContain('Resposta: "texto da v2"');
    const v2 = await db.query(`SELECT mostrado_em FROM rascunhos WHERE demanda_id = $1 AND versao = 2`, [id]);
    expect(v2.rows[0].mostrado_em).not.toBeNull();
  });
});

describe('avisarUrgente', () => {
  it('envia mesmo no silêncio e só uma vez', async () => {
    const id = await demanda({ prioridade: 'urgente', titulo: 'Container parado' });
    await avisarUrgente(deps(NOITE), id);
    expect(enviadas).toHaveLength(1);
    expect(enviadas[0]).toContain('Ana: 1 pedido novo');
    expect(enviadas[0]).toContain('Container parado');
    await avisarUrgente(deps(NOITE), id);
    expect(enviadas).toHaveLength(1);
    expect(await cicloAna(deps())).toBe(0);
  });
});

describe('aviso de limite', () => {
  const gasto = (usd: number, quando: string) =>
    db.query(`INSERT INTO uso_ia (agente, modelo, custo_usd, criado_em) VALUES ('triagem','x',$1,$2)`, [usd, quando]);

  it('sai uma vez por mês', async () => {
    await gasto(41, '2026-10-10T12:00:00Z');
    await cicloAna(deps());
    await cicloAna(deps());
    expect(enviadas).toHaveLength(1);
    expect(enviadas[0]).toContain('80%');
    expect((await db.query(`SELECT chave FROM avisos`)).rows[0].chave).toBe('limite-aviso-2026-10');
  });

  it('estourado avisa à parte do aviso, e de novo no mês seguinte', async () => {
    await gasto(41, '2026-10-10T12:00:00Z');
    await cicloAna(deps());
    await gasto(10, '2026-10-11T12:00:00Z');
    await cicloAna(deps());
    await cicloAna(deps());
    expect(enviadas).toHaveLength(2);
    expect(enviadas[1]).toContain('limite mensal');
    expect(enviadas[1]).toContain('análise do especialista');
    expect(enviadas[1]).toContain('interpretação de texto livre');
    expect(enviadas[1]).toContain('a triagem continua');
    await gasto(60, '2026-11-03T12:00:00Z');
    await cicloAna(deps(new Date('2026-11-03T15:00:00Z')));
    expect(enviadas).toHaveLength(3);
    expect((await db.query(`SELECT chave FROM avisos ORDER BY chave`)).rows.map((r) => r.chave)).toContain('limite-estourado-2026-11');
  });

  it('abaixo de 80% não avisa, e no silêncio fica para depois', async () => {
    await gasto(10, '2026-10-10T12:00:00Z');
    await cicloAna(deps());
    expect(enviadas).toEqual([]);
    await gasto(35, '2026-10-12T12:00:00Z');
    await cicloAna(deps(NOITE));
    expect(enviadas).toEqual([]);
    await cicloAna(deps());
    expect(enviadas).toHaveLength(1);
  });

  it('se o envio falha, a chave é liberada para nova tentativa', async () => {
    await gasto(41, '2026-10-10T12:00:00Z');
    await expect(cicloAna(deps(DIA_UTIL, { enviar: falha('x') }))).rejects.toThrow('x');
    expect((await db.query(`SELECT count(*)::int n FROM avisos`)).rows[0].n).toBe(0);
  });
});
