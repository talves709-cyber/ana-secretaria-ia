// Consultas do painel do CRM: quadro do pipeline, ficha do cliente e bases de conhecimento.
import type { Db } from './db.js';
import type { Etapa, EtapaSugerida } from './demandas.js';

export interface FiltrosQuadro {
  empresaId?: number;
  categoriaId?: number;
  clienteId?: number;
}

export interface CartaoQuadro {
  id: number;
  etapa: Etapa;
  titulo: string;
  cliente: string;
  clienteId: number;
  empresa: string | null;
  categoria: string | null;
  prioridade: string;
  prazo: Date | null;
  etapaDesde: Date;
  /** Texto do rascunho de resposta mais recente, se houver. */
  resposta: string | null;
  etapaSugerida: EtapaSugerida | null;
}

export interface FichaCliente {
  id: number;
  nome: string;
  contatos: string[];
  demandas: CartaoQuadro[];
}

export interface BaseEmpresa {
  empresaId: number;
  empresa: string;
  versao: number;
  texto: string;
}

const DIA_MS = 24 * 60 * 60 * 1000;
const LIMITE_FICHA = 200;

const SELECT_CARTAO = `SELECT d.id, d.etapa, d.titulo, d.cliente_id, c.nome AS cliente, e.nome AS empresa, k.nome AS categoria,
    d.prioridade, d.prazo, d.etapa_desde, d.etapa_sugerida,
    (SELECT r.texto FROM rascunhos r WHERE r.demanda_id = d.id ORDER BY r.versao DESC LIMIT 1) AS resposta
  FROM demandas d
  JOIN clientes c ON c.id = d.cliente_id
  LEFT JOIN empresas e ON e.id = d.empresa_id
  LEFT JOIN categorias k ON k.id = d.categoria_id`;

const ORDEM_PRIORIDADE = `CASE d.prioridade WHEN 'urgente' THEN 0 WHEN 'alta' THEN 1 WHEN 'media' THEN 2 ELSE 3 END`;

function paraCartao(r: Record<string, any>): CartaoQuadro {
  return {
    id: Number(r.id),
    etapa: r.etapa,
    titulo: r.titulo,
    cliente: r.cliente,
    clienteId: Number(r.cliente_id),
    empresa: r.empresa,
    categoria: r.categoria,
    prioridade: r.prioridade,
    prazo: r.prazo,
    etapaDesde: r.etapa_desde,
    resposta: r.resposta,
    etapaSugerida: r.etapa_sugerida,
  };
}

/** Etapas abertas mais as concluídas dos últimos 7 dias, as mais urgentes e paradas há mais tempo primeiro. */
export async function quadro(db: Db, f: FiltrosQuadro, agora: Date = new Date()): Promise<CartaoQuadro[]> {
  const corte = new Date(agora.getTime() - 7 * DIA_MS);
  const r = await db.query(
    `${SELECT_CARTAO}
     WHERE (d.etapa <> 'concluido' OR d.etapa_desde >= $1)
       AND ($2::bigint IS NULL OR d.empresa_id = $2)
       AND ($3::bigint IS NULL OR d.categoria_id = $3)
       AND ($4::bigint IS NULL OR d.cliente_id = $4)
     ORDER BY ${ORDEM_PRIORIDADE}, d.etapa_desde ASC, d.id ASC`,
    [corte, f.empresaId ?? null, f.categoriaId ?? null, f.clienteId ?? null],
  );
  return r.rows.map(paraCartao);
}

export async function fichaCliente(db: Db, clienteId: number): Promise<FichaCliente | null> {
  const c = await db.query(`SELECT id, nome FROM clientes WHERE id = $1`, [clienteId]);
  if (!c.rows[0]) return null;
  const contatos = await db.query(`SELECT valor FROM cliente_contatos WHERE cliente_id = $1 ORDER BY id`, [clienteId]);
  const demandas = await db.query(
    `${SELECT_CARTAO}
     WHERE d.cliente_id = $1
     ORDER BY (d.etapa = 'concluido'), ${ORDEM_PRIORIDADE}, d.etapa_desde DESC, d.id DESC
     LIMIT ${LIMITE_FICHA}`,
    [clienteId],
  );
  return {
    id: Number(c.rows[0].id),
    nome: c.rows[0].nome,
    contatos: contatos.rows.map((x) => x.valor),
    demandas: demandas.rows.map(paraCartao),
  };
}

/** Grava o texto como nova versão da base da empresa; texto igual ao da versão atual não cria versão. */
export async function salvarBase(db: Db, empresaId: number, texto: string): Promise<void> {
  await db.query(
    `INSERT INTO bases_conhecimento (empresa_id, versao, texto)
     SELECT $1::bigint, coalesce(max(versao), 0) + 1, $2::text FROM bases_conhecimento WHERE empresa_id = $1
     HAVING coalesce((SELECT texto FROM bases_conhecimento WHERE empresa_id = $1 ORDER BY versao DESC LIMIT 1), '') IS DISTINCT FROM $2`,
    [empresaId, texto],
  );
}

/** Versão mais recente da base de cada empresa. */
export async function bases(db: Db): Promise<BaseEmpresa[]> {
  const r = await db.query(
    `SELECT DISTINCT ON (b.empresa_id) b.empresa_id, e.nome AS empresa, b.versao, b.texto
     FROM bases_conhecimento b JOIN empresas e ON e.id = b.empresa_id
     ORDER BY b.empresa_id, b.versao DESC`,
  );
  return r.rows
    .map((x) => ({ empresaId: Number(x.empresa_id), empresa: x.empresa as string, versao: Number(x.versao), texto: x.texto as string }))
    .sort((a, b) => a.empresa.localeCompare(b.empresa, 'pt-BR'));
}

export async function opcoesFiltro(db: Db): Promise<{ empresas: { id: number; nome: string }[]; categorias: { id: number; nome: string }[] }> {
  const e = await db.query(`SELECT id, nome FROM empresas ORDER BY nome`);
  const k = await db.query(`SELECT id, nome FROM categorias ORDER BY nome`);
  const mapa = (x: Record<string, any>) => ({ id: Number(x.id), nome: x.nome as string });
  return { empresas: e.rows.map(mapa), categorias: k.rows.map(mapa) };
}
