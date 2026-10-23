import type { Db } from './db.js';

export interface Taxonomia {
  empresas: { id: number; nome: string; segmentoId: number | null; apelidos: string[]; descricao: string | null; palavras: string[] }[];
  negocios: { id: number; empresaId: number; nome: string; descricao: string | null }[];
  categorias: { id: number; nome: string; descricao: string | null }[];
}

export async function carregarTaxonomia(db: Db): Promise<Taxonomia> {
  const [empresas, negocios, categorias] = await Promise.all([
    db.query(`SELECT id, nome, segmento_id, apelidos, descricao, palavras_chave FROM empresas ORDER BY id`),
    db.query(`SELECT id, empresa_id, nome, descricao FROM negocios WHERE status = 'ativo' ORDER BY empresa_id, id`),
    db.query(`SELECT id, nome, descricao FROM categorias ORDER BY id`),
  ]);
  return {
    empresas: empresas.rows.map((r) => ({
      id: Number(r.id),
      nome: r.nome,
      segmentoId: r.segmento_id === null ? null : Number(r.segmento_id),
      apelidos: r.apelidos,
      descricao: r.descricao,
      palavras: r.palavras_chave,
    })),
    negocios: negocios.rows.map((r) => ({ id: Number(r.id), empresaId: Number(r.empresa_id), nome: r.nome, descricao: r.descricao })),
    categorias: categorias.rows.map((r) => ({ id: Number(r.id), nome: r.nome, descricao: r.descricao })),
  };
}

export interface MensagemParaIA {
  id: number;
  recebidaEm: Date;
  deMim: boolean;
  autor: string;
  tipo: string;
  texto: string | null;
}

export interface ConversaParaIA {
  id: number;
  tipo: 'individual' | 'grupo';
  nome: string;
  empresaDoContato: string | null;
  pendentes: MensagemParaIA[];
  contexto: MensagemParaIA[];
}

const LIMITE_PENDENTES = 50;
const LIMITE_CONTEXTO = 10;

const SELECT_MENSAGEM = `
  SELECT m.id, m.recebida_em, m.de_mim, m.tipo, m.texto, COALESCE(k.nome, k.jid, '') AS autor
  FROM mensagens m LEFT JOIN contatos k ON k.id = m.remetente_id`;

function paraIA(r: any): MensagemParaIA {
  return { id: Number(r.id), recebidaEm: r.recebida_em, deMim: r.de_mim, autor: r.autor, tipo: r.tipo, texto: r.texto };
}

/** Mensagens com texto ainda sem classificação, mais as anteriores como contexto. */
export async function carregarConversa(db: Db, conversaId: number): Promise<ConversaParaIA | null> {
  const c = await db.query(
    `SELECT c.id, c.tipo, COALESCE(c.nome, k.nome, c.jid) AS nome, e.nome AS empresa
     FROM conversas c
     LEFT JOIN contatos k ON k.id = c.contato_id
     LEFT JOIN empresas e ON e.id = k.empresa_padrao_id
     WHERE c.id = $1`,
    [conversaId],
  );
  if (!c.rows[0]) return null;
  const pendentes = await db.query(
    `${SELECT_MENSAGEM}
     WHERE m.conversa_id = $1 AND m.texto IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM classificacoes cl WHERE cl.mensagem_id = m.id)
     ORDER BY m.recebida_em, m.id
     LIMIT ${LIMITE_PENDENTES}`,
    [conversaId],
  );
  const primeira = pendentes.rows[0];
  const contexto = primeira
    ? await db.query(
        `${SELECT_MENSAGEM}
         WHERE m.conversa_id = $1 AND m.recebida_em < $2 AND m.texto IS NOT NULL
         ORDER BY m.recebida_em DESC
         LIMIT ${LIMITE_CONTEXTO}`,
        [conversaId, primeira.recebida_em],
      )
    : { rows: [] };
  return {
    id: Number(c.rows[0].id),
    tipo: c.rows[0].tipo,
    nome: c.rows[0].nome,
    empresaDoContato: c.rows[0].empresa,
    pendentes: pendentes.rows.map(paraIA),
    contexto: contexto.rows.reverse().map(paraIA),
  };
}

export interface ClassificacaoParaGravar {
  empresaId: number | null;
  negocioId: number | null;
  segmentoId: number | null;
  categoriaId: number | null;
  prioridade: string;
  resumo: string;
  acaoSugerida: string;
  confianca: number;
  modelo: string;
}

/** Grava a mesma classificação para cada mensagem do bloco, numa transação. */
export async function gravarClassificacoes(
  db: Db,
  mensagemIds: number[],
  c: ClassificacaoParaGravar,
  empresaSugerida: string | null,
) {
  const cliente = await db.connect();
  try {
    await cliente.query('BEGIN');
    for (const id of mensagemIds) {
      await cliente.query(
        `INSERT INTO classificacoes
           (mensagem_id, empresa_id, negocio_id, segmento_id, categoria_id, prioridade, resumo, acao_sugerida, confianca, modelo)
         SELECT $1, $2, $3, $4, $5, $6, $7, $8, $9, $10
         WHERE NOT EXISTS (SELECT 1 FROM classificacoes WHERE mensagem_id = $1)`,
        [id, c.empresaId, c.negocioId, c.segmentoId, c.categoriaId, c.prioridade, c.resumo, c.acaoSugerida, c.confianca, c.modelo],
      );
    }
    if (empresaSugerida) {
      await cliente.query(`INSERT INTO sugestoes (tipo, nome_sugerido, mensagem_ids) VALUES ('empresa', $1, $2)`, [
        empresaSugerida,
        mensagemIds,
      ]);
    }
    await cliente.query('COMMIT');
  } catch (erro) {
    await cliente.query('ROLLBACK');
    throw erro;
  } finally {
    cliente.release();
  }
}
