// A Ana avisa o Thiago: pacotes de pedidos novos, urgentes na hora, e aviso de limite de IA.
// A mensagem é para o próprio dono (não passa pelo Executor, que é só para terceiros).
import type { Db } from './db.js';
import type { EtapaSugerida } from './demandas.js';
import { emSilencio } from './silencio.js';
import { gastoDoMes, situacaoLimite } from './uso-ia.js';

const MAX_POR_PACOTE = 5;
const MAX_RESPOSTA = 300;

export interface ItemPacote {
  id: number;
  empresa: string | null;
  cliente: string;
  titulo: string;
  etapaSugerida: EtapaSugerida | null;
  resposta: string | null;
  prioridade: string;
}

export interface DepsAna {
  db: Db;
  /** Manda uma mensagem ao Thiago (já começando com "Ana:"). */
  enviar(texto: string): Promise<void>;
  limiteMensalUsd: number;
  silencioInicio?: number;
  silencioFim?: number;
  agora?: () => Date;
}

const ROTULO_SUGESTAO: Record<EtapaSugerida, string> = {
  concluir: 'responder e concluir',
  aguardar: 'responder e aguardar retorno',
  agendar: 'agendar',
  comigo: 'fica com você',
};

function cortar(texto: string): string {
  return texto.length > MAX_RESPOSTA ? `${texto.slice(0, MAX_RESPOSTA)}…` : texto;
}

export function formatarPacote(itens: ItemPacote[]): string {
  const blocos = itens.map((i) => {
    const linhas = [`#${i.id} ${i.empresa ? `${i.empresa} · ` : ''}${i.cliente}`, i.titulo];
    if (i.etapaSugerida) linhas.push(`Sugiro: ${ROTULO_SUGESTAO[i.etapaSugerida]}.`);
    if (i.resposta) linhas.push(`Resposta: "${cortar(i.resposta)}"`);
    return linhas.join('\n');
  });
  const titulo = `Ana: ${itens.length} ${itens.length === 1 ? 'pedido novo' : 'pedidos novos'}`;
  const rodape = 'Responda: ok 14 · 14 aguardar · 14 comigo · 14 agenda quinta 15h · 14 muda: novo texto';
  return `${titulo}\n\n${blocos.join('\n\n')}\n\n${rodape}`;
}

const SQL_ITENS = `
  SELECT d.id, e.nome AS empresa, c.nome AS cliente, d.titulo, d.etapa_sugerida, d.prioridade,
         (SELECT r.texto FROM rascunhos r WHERE r.demanda_id = d.id ORDER BY r.versao DESC LIMIT 1) AS resposta
    FROM demandas d
    JOIN clientes c ON c.id = d.cliente_id
    LEFT JOIN empresas e ON e.id = d.empresa_id`;

function paraItem(r: Record<string, any>): ItemPacote {
  return {
    id: Number(r.id),
    empresa: r.empresa,
    cliente: r.cliente,
    titulo: r.titulo,
    etapaSugerida: r.etapa_sugerida,
    resposta: r.resposta,
    prioridade: r.prioridade,
  };
}

/**
 * Reserva (marca avisada_em) antes de enviar, para duas execuções não avisarem a mesma demanda;
 * se o envio falhar, devolve a reserva e relança, e o próximo ciclo tenta de novo.
 */
async function reservarEEnviar(d: DepsAna, ids: number[]): Promise<number> {
  if (ids.length === 0) return 0;
  const reservadas = await d.db.query(
    `UPDATE demandas SET avisada_em = now() WHERE id = ANY($1::bigint[]) AND avisada_em IS NULL RETURNING id`,
    [ids],
  );
  const meus = new Set(reservadas.rows.map((r) => Number(r.id)));
  const lista = ids.filter((id) => meus.has(id));
  if (lista.length === 0) return 0;
  const itens = await d.db.query(`${SQL_ITENS} WHERE d.id = ANY($1::bigint[])`, [lista]);
  const ordenados = lista.map((id) => paraItem(itens.rows.find((r) => Number(r.id) === id)!));
  try {
    await d.enviar(formatarPacote(ordenados));
  } catch (e) {
    await d.db.query(`UPDATE demandas SET avisada_em = NULL WHERE id = ANY($1::bigint[])`, [lista]);
    throw e;
  }
  return lista.length;
}

async function avisarLimite(d: DepsAna, agora: Date): Promise<void> {
  const situacao = situacaoLimite(await gastoDoMes(d.db, agora), d.limiteMensalUsd);
  if (situacao === 'ok') return;
  const mes = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit' })
    .format(agora)
    .slice(0, 7);
  const chave = `limite-${situacao}-${mes}`;
  const nova = await d.db.query(`INSERT INTO avisos (chave) VALUES ($1) ON CONFLICT DO NOTHING RETURNING chave`, [chave]);
  if (nova.rows.length === 0) return;
  const texto =
    situacao === 'estourado'
      ? 'Ana: O limite mensal de IA foi atingido. Pausei a análise automática até o próximo mês; os pedidos continuam sendo gravados.'
      : 'Ana: O gasto com IA neste mês passou de 80% do limite.';
  try {
    await d.enviar(texto);
  } catch (e) {
    await d.db.query(`DELETE FROM avisos WHERE chave = $1`, [chave]);
    throw e;
  }
}

/** Um ciclo: aviso de limite e um pacote de até 5 demandas novas, ambos só fora do silêncio. Devolve quantas demandas avisou. */
export async function cicloAna(d: DepsAna): Promise<number> {
  const agora = (d.agora ?? (() => new Date()))();
  if (emSilencio(agora, d.silencioInicio, d.silencioFim)) return 0;
  await avisarLimite(d, agora);
  const r = await d.db.query(
    `SELECT id FROM demandas WHERE etapa = 'novo' AND avisada_em IS NULL
      ORDER BY CASE prioridade WHEN 'urgente' THEN 0 WHEN 'alta' THEN 1 WHEN 'media' THEN 2 ELSE 3 END, criado_em, id
      LIMIT $1`,
    [MAX_POR_PACOTE],
  );
  return reservarEEnviar(d, r.rows.map((x) => Number(x.id)));
}

/** Avisa já, sem olhar o silêncio. Não faz nada se a demanda já foi avisada. */
export async function avisarUrgente(d: DepsAna, demandaId: number): Promise<void> {
  await reservarEEnviar(d, [demandaId]);
}
