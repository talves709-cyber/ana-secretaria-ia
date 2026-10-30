import type { Db } from './db.js';
import type { MensagemParaIA } from './classificacao-dados.js';
import { anexarItens, atualizarDemanda, criarDemanda, emTransacao, garantirClienteDaConversa, mudarEtapa, salvarRascunho } from './demandas.js';
import type { EscritaEspecialista } from './especialista.js';

export interface BlocoEspecialista {
  conversaId: number;
  conversaJid: string;
  conversaNome: string;
  tipo: 'individual' | 'grupo';
  empresaId: number | null;
  categoriaId: number | null;
  prioridade: string;
  acaoSugerida: string;
  resumo: string;
  /** Classificadas e ainda sem linha em demanda_itens. */
  mensagens: MensagemParaIA[];
  /** Até 10 anteriores ao bloco. */
  contexto: MensagemParaIA[];
}

const LIMITE_BLOCO = 50;
const LIMITE_CONTEXTO = 10;

const SELECT_MENSAGEM = `
  SELECT m.id, m.recebida_em, m.de_mim, m.tipo, m.texto, COALESCE(k.nome, k.jid, '') AS autor
  FROM mensagens m LEFT JOIN contatos k ON k.id = m.remetente_id`;

function paraIA(r: any): MensagemParaIA {
  return { id: Number(r.id), recebidaEm: r.recebida_em, deMim: r.de_mim, autor: r.autor, tipo: r.tipo, texto: r.texto };
}

const numOuNulo = (v: unknown): number | null => (v == null ? null : Number(v));

/** Bloco a analisar: mensagens com texto, já classificadas e ainda sem item de demanda. A classificação usada é a da mensagem mais recente. */
export async function carregarBloco(db: Db, conversaId: number): Promise<BlocoEspecialista | null> {
  const c = await db.query(
    `SELECT c.jid, c.tipo, COALESCE(c.nome, k.nome, c.jid) AS nome
       FROM conversas c LEFT JOIN contatos k ON k.id = c.contato_id WHERE c.id = $1`,
    [conversaId],
  );
  if (!c.rows[0]) return null;
  const novas = await db.query(
    `${SELECT_MENSAGEM}
     WHERE m.conversa_id = $1 AND m.texto IS NOT NULL
       AND EXISTS (SELECT 1 FROM classificacoes cl WHERE cl.mensagem_id = m.id)
       AND NOT EXISTS (SELECT 1 FROM demanda_itens di WHERE di.mensagem_id = m.id)
     ORDER BY m.recebida_em, m.id
     LIMIT ${LIMITE_BLOCO}`,
    [conversaId],
  );
  if (novas.rows.length === 0) return null;
  const mensagens = novas.rows.map(paraIA);
  const ultima = mensagens[mensagens.length - 1]!;
  const cl = await db.query(
    `SELECT empresa_id, categoria_id, prioridade, acao_sugerida, resumo FROM classificacoes
      WHERE mensagem_id = $1 ORDER BY id DESC LIMIT 1`,
    [ultima.id],
  );
  const contexto = await db.query(
    `${SELECT_MENSAGEM}
     WHERE m.conversa_id = $1 AND m.texto IS NOT NULL AND (m.recebida_em, m.id) < ($2::timestamptz, $3::bigint)
     ORDER BY m.recebida_em DESC, m.id DESC
     LIMIT ${LIMITE_CONTEXTO}`,
    [conversaId, mensagens[0]!.recebidaEm, mensagens[0]!.id],
  );
  const k = cl.rows[0] ?? {};
  return {
    conversaId,
    conversaJid: c.rows[0].jid,
    conversaNome: c.rows[0].nome,
    tipo: c.rows[0].tipo,
    empresaId: numOuNulo(k.empresa_id),
    categoriaId: numOuNulo(k.categoria_id),
    prioridade: k.prioridade ?? 'media',
    acaoSugerida: k.acao_sugerida ?? 'acompanhar',
    resumo: k.resumo ?? '',
    mensagens,
    contexto: contexto.rows.reverse().map(paraIA),
  };
}

/** Texto da última versão da base de conhecimento; vazio sem empresa. */
export async function baseDaEmpresa(db: Db, empresaId: number | null): Promise<string> {
  if (empresaId === null) return '';
  const r = await db.query(`SELECT texto FROM bases_conhecimento WHERE empresa_id = $1 ORDER BY versao DESC LIMIT 1`, [empresaId]);
  return r.rows[0]?.texto ?? '';
}

export async function nomeDaEmpresa(db: Db, empresaId: number | null): Promise<string> {
  if (empresaId === null) return '';
  const r = await db.query(`SELECT nome FROM empresas WHERE id = $1`, [empresaId]);
  return r.rows[0]?.nome ?? '';
}

/** Exemplos de estilo (antes → depois) da empresa, mais recentes primeiro. */
export async function exemplosDaEmpresa(db: Db, empresaId: number | null, limite = 5): Promise<{ antes: string; depois: string }[]> {
  if (empresaId === null) return [];
  const r = await db.query(`SELECT antes, depois FROM exemplos_estilo WHERE empresa_id = $1 ORDER BY id DESC LIMIT $2`, [empresaId, limite]);
  return r.rows.map((x) => ({ antes: x.antes, depois: x.depois }));
}

/** Executa as escritas do especialista numa única transação (commit só se todas passarem). */
export function transacaoDoEspecialista<T>(db: Db, fn: (e: EscritaEspecialista) => Promise<T>): Promise<T> {
  return emTransacao(db, (c) =>
    fn({
      garantirCliente: (id) => garantirClienteDaConversa(c, id),
      criarDemanda: (d) => criarDemanda(c, d),
      atualizarDemanda: (id, campos) => atualizarDemanda(c, id, campos),
      anexarItens: (demandaId, ids) => anexarItens(c, demandaId, ids),
      mudarEtapa: (id, para, autor, motivo) => mudarEtapa(c, id, para, autor, motivo),
      salvarRascunho: (demandaId, texto, destino) => salvarRascunho(c, demandaId, texto, destino),
    }),
  );
}
