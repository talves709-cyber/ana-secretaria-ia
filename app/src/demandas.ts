import { createHash } from 'node:crypto';
import type { Db } from './db.js';

export const ETAPAS = ['novo', 'comigo', 'aguardando_terceiro', 'agendado', 'concluido'] as const;
export type Etapa = (typeof ETAPAS)[number];
export type EtapaSugerida = 'concluir' | 'agendar' | 'aguardar' | 'comigo';
export type Autor = 'thiago' | 'ana' | 'agente';

export interface Demanda {
  id: number;
  clienteId: number;
  conversaId: number | null;
  empresaId: number | null;
  categoriaId: number | null;
  titulo: string;
  plano: string | null;
  prazo: Date | null;
  prazoTemHora: boolean;
  etapa: Etapa;
  etapaSugerida: EtapaSugerida | null;
  prioridade: 'baixa' | 'media' | 'alta' | 'urgente';
  avisadaEm: Date | null;
  criadoEm: Date;
  etapaDesde: Date;
}

export interface Rascunho {
  id: number;
  demandaId: number;
  versao: number;
  texto: string;
  destino: string;
  hash: string;
  criadoEm: Date;
}

export type NovaDemanda = Omit<Demanda, 'id' | 'etapa' | 'avisadaEm' | 'criadoEm' | 'etapaDesde'>;

const COLUNAS_DEMANDA = `id, cliente_id, conversa_id, empresa_id, categoria_id, titulo, plano, prazo, prazo_tem_hora,
  etapa, etapa_sugerida, prioridade, avisada_em, criado_em, etapa_desde`;

const COLUNAS_RASCUNHO = 'id, demanda_id, versao, texto, destino, hash, criado_em';

// O driver devolve bigint como string; os ids são pequenos, então convertemos para number.
const num = (v: unknown): number => Number(v);
const numOuNulo = (v: unknown): number | null => (v == null ? null : Number(v));

function paraDemanda(r: Record<string, any>): Demanda {
  return {
    id: num(r.id),
    clienteId: num(r.cliente_id),
    conversaId: numOuNulo(r.conversa_id),
    empresaId: numOuNulo(r.empresa_id),
    categoriaId: numOuNulo(r.categoria_id),
    titulo: r.titulo,
    plano: r.plano,
    prazo: r.prazo,
    prazoTemHora: r.prazo_tem_hora,
    etapa: r.etapa,
    etapaSugerida: r.etapa_sugerida,
    prioridade: r.prioridade,
    avisadaEm: r.avisada_em,
    criadoEm: r.criado_em,
    etapaDesde: r.etapa_desde,
  };
}

function paraRascunho(r: Record<string, any>): Rascunho {
  return {
    id: num(r.id),
    demandaId: num(r.demanda_id),
    versao: r.versao,
    texto: r.texto,
    destino: r.destino,
    hash: r.hash,
    criadoEm: r.criado_em,
  };
}

async function emTransacao<T>(db: Db, fn: (c: import('pg').PoolClient) => Promise<T>): Promise<T> {
  const c = await db.connect();
  try {
    await c.query('BEGIN');
    const r = await fn(c);
    await c.query('COMMIT');
    return r;
  } catch (erro) {
    await c.query('ROLLBACK').catch(() => undefined);
    throw erro;
  } finally {
    c.release();
  }
}

/** Cliente da conversa (WhatsApp, pelo jid); cria se não existir. Nunca mescla clientes. */
export async function garantirClienteDaConversa(db: Db, conversaId: number): Promise<number> {
  return emTransacao(db, async (c) => {
    const conv = await c.query(
      `SELECT c.jid, COALESCE(c.nome, ct.nome, c.jid) AS nome
         FROM conversas c LEFT JOIN contatos ct ON ct.id = c.contato_id
        WHERE c.id = $1`,
      [conversaId],
    );
    if (conv.rows.length === 0) throw new Error(`Conversa ${conversaId} não existe`);
    const { jid, nome } = conv.rows[0];
    // Serializa chamadas concorrentes para o mesmo jid, para não criar dois clientes.
    await c.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`cliente:${jid}`]);
    const existente = await c.query(`SELECT cliente_id FROM cliente_contatos WHERE tipo = 'whatsapp' AND valor = $1`, [jid]);
    if (existente.rows.length > 0) return num(existente.rows[0].cliente_id);
    const criado = await c.query(`INSERT INTO clientes (nome) VALUES ($1) RETURNING id`, [nome]);
    const clienteId = num(criado.rows[0].id);
    await c.query(`INSERT INTO cliente_contatos (cliente_id, tipo, valor) VALUES ($1, 'whatsapp', $2)`, [clienteId, jid]);
    return clienteId;
  });
}

/** Demandas não concluídas da conversa, mais recentes primeiro, até 5. */
export async function demandasAbertasDaConversa(db: Db, conversaId: number): Promise<Demanda[]> {
  const r = await db.query(
    `SELECT ${COLUNAS_DEMANDA} FROM demandas
      WHERE conversa_id = $1 AND etapa <> 'concluido'
      ORDER BY criado_em DESC, id DESC
      LIMIT 5`,
    [conversaId],
  );
  return r.rows.map(paraDemanda);
}

export async function criarDemanda(db: Db, d: NovaDemanda): Promise<Demanda> {
  return emTransacao(db, async (c) => {
    const r = await c.query(
      `INSERT INTO demandas
         (cliente_id, conversa_id, empresa_id, categoria_id, titulo, plano, prazo, prazo_tem_hora, etapa_sugerida, prioridade)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING ${COLUNAS_DEMANDA}`,
      [d.clienteId, d.conversaId, d.empresaId, d.categoriaId, d.titulo, d.plano, d.prazo, d.prazoTemHora, d.etapaSugerida, d.prioridade],
    );
    const criada = paraDemanda(r.rows[0]);
    await c.query(`INSERT INTO demanda_etapas (demanda_id, de, para, autor) VALUES ($1, NULL, 'novo', 'agente')`, [criada.id]);
    return criada;
  });
}

const CAMPOS_ATUALIZAVEIS = {
  titulo: 'titulo',
  plano: 'plano',
  prazo: 'prazo',
  prazoTemHora: 'prazo_tem_hora',
  etapaSugerida: 'etapa_sugerida',
  prioridade: 'prioridade',
} as const;

/** Atualiza só os campos informados (a etapa muda apenas por `mudarEtapa`). */
export async function atualizarDemanda(
  db: Db,
  id: number,
  campos: Partial<Pick<Demanda, 'titulo' | 'plano' | 'prazo' | 'prazoTemHora' | 'etapaSugerida' | 'prioridade'>>,
): Promise<void> {
  const sets: string[] = [];
  const valores: unknown[] = [];
  for (const [chave, coluna] of Object.entries(CAMPOS_ATUALIZAVEIS)) {
    const valor = (campos as Record<string, unknown>)[chave];
    if (valor === undefined) continue;
    valores.push(valor);
    sets.push(`${coluna} = $${valores.length}`);
  }
  if (sets.length === 0) return;
  valores.push(id);
  await db.query(`UPDATE demandas SET ${sets.join(', ')} WHERE id = $${valores.length}`, valores);
}

/** Liga mensagens a uma demanda (ou as marca como analisadas, com `demandaId` nulo). Mensagem já ligada é mantida. */
export async function anexarItens(db: Db, demandaId: number | null, mensagemIds: number[]): Promise<void> {
  if (mensagemIds.length === 0) return;
  await db.query(
    `INSERT INTO demanda_itens (mensagem_id, demanda_id)
     SELECT m, $1 FROM unnest($2::bigint[]) AS m
     ON CONFLICT (mensagem_id) DO NOTHING`,
    [demandaId, mensagemIds],
  );
}

/** Muda a etapa, atualiza `etapa_desde` e grava o histórico. Não faz nada se já está em `para`. */
export async function mudarEtapa(db: Db, id: number, para: Etapa, autor: Autor, motivo: string): Promise<void> {
  await emTransacao(db, async (c) => {
    const atual = await c.query(`SELECT etapa FROM demandas WHERE id = $1 FOR UPDATE`, [id]);
    if (atual.rows.length === 0) throw new Error(`Demanda ${id} não existe`);
    const de: string = atual.rows[0].etapa;
    if (de === para) return;
    await c.query(`UPDATE demandas SET etapa = $2, etapa_desde = now() WHERE id = $1`, [id, para]);
    await c.query(`INSERT INTO demanda_etapas (demanda_id, de, para, autor, motivo) VALUES ($1, $2, $3, $4, $5)`, [id, de, para, autor, motivo]);
  });
}

export async function buscarDemanda(db: Db, id: number): Promise<Demanda | null> {
  const r = await db.query(`SELECT ${COLUNAS_DEMANDA} FROM demandas WHERE id = $1`, [id]);
  return r.rows.length ? paraDemanda(r.rows[0]) : null;
}

/** Nova versão do rascunho (max + 1). O hash cobre destino e texto: o que foi aprovado é exatamente o que sai. */
export async function salvarRascunho(db: Db, demandaId: number, texto: string, destino: string): Promise<Rascunho> {
  const hash = createHash('sha256').update(`${destino}\n${texto}`).digest('hex');
  return emTransacao(db, async (c) => {
    // Trava a demanda para que versões concorrentes não colidam em (demanda_id, versao).
    const trava = await c.query(`SELECT id FROM demandas WHERE id = $1 FOR UPDATE`, [demandaId]);
    if (trava.rows.length === 0) throw new Error(`Demanda ${demandaId} não existe`);
    const r = await c.query(
      `INSERT INTO rascunhos (demanda_id, versao, texto, destino, hash)
       SELECT $1, COALESCE(MAX(versao), 0) + 1, $2, $3, $4 FROM rascunhos WHERE demanda_id = $1
       RETURNING ${COLUNAS_RASCUNHO}`,
      [demandaId, texto, destino, hash],
    );
    return paraRascunho(r.rows[0]);
  });
}

export async function rascunhoAtual(db: Db, demandaId: number): Promise<Rascunho | null> {
  const r = await db.query(`SELECT ${COLUNAS_RASCUNHO} FROM rascunhos WHERE demanda_id = $1 ORDER BY versao DESC LIMIT 1`, [demandaId]);
  return r.rows.length ? paraRascunho(r.rows[0]) : null;
}
