/**
 * Executor de envio: o único caminho pelo qual uma resposta sai para um cliente.
 * Só envia com aprovação válida e revalida tudo no momento do envio.
 */
import { emTransacao, hashRascunho } from './demandas.js';
import type { Db } from './db.js';
import { ErroEnvioIncerto } from './evolution.js';

export type ResultadoEnvio = { tipo: 'enviado' } | { tipo: 'bloqueado'; motivo: string } | { tipo: 'falhou'; erro: string };

export interface CanalWhatsApp {
  /** Lança ErroEnvioIncerto se não houve resposta (a mensagem pode ter saído); id nulo = enviado sem id. */
  enviarTexto(jid: string, texto: string): Promise<{ id: string | null }>;
}

const VALIDADE_APROVACAO_MS = 24 * 60 * 60 * 1000;

function bloqueado(motivo: string): ResultadoEnvio {
  return { tipo: 'bloqueado', motivo };
}

interface Reservado {
  envioId: number;
  destino: string;
  texto: string;
}

/** Checagens 1 a 5, numa transação que trava a demanda: duas aprovações concorrentes não passam juntas. */
async function reservar(db: Db, aprovacaoId: number, agora: Date): Promise<Reservado | ResultadoEnvio> {
  return emTransacao(db, async (c): Promise<Reservado | ResultadoEnvio> => {
    const ref = await c.query(
      `SELECT r.demanda_id FROM aprovacoes a JOIN rascunhos r ON r.id = a.rascunho_id WHERE a.id = $1`,
      [aprovacaoId],
    );
    if (ref.rows.length === 0) return bloqueado('aprovação vencida');
    await c.query(`SELECT id FROM demandas WHERE id = $1 FOR UPDATE`, [Number(ref.rows[0].demanda_id)]);

    // 1. Aprovação com menos de 24 h.
    const ap = await c.query(`SELECT rascunho_id, hash, criado_em FROM aprovacoes WHERE id = $1`, [aprovacaoId]);
    if (agora.getTime() - new Date(ap.rows[0].criado_em).getTime() >= VALIDADE_APROVACAO_MS) {
      return bloqueado('aprovação vencida');
    }

    // 2. O rascunho aprovado é a versão atual da demanda e o hash confere.
    const rs = await c.query(
      `SELECT r.id, r.demanda_id, r.versao, r.texto, r.destino, r.hash, r.criado_em,
              (SELECT max(versao) FROM rascunhos WHERE demanda_id = r.demanda_id) AS versao_atual
         FROM rascunhos r WHERE r.id = $1`,
      [Number(ap.rows[0].rascunho_id)],
    );
    const r = rs.rows[0];
    if (
      Number(r.versao) !== Number(r.versao_atual) ||
      r.hash !== ap.rows[0].hash ||
      r.hash !== hashRascunho(r.destino, r.texto)
    ) {
      return bloqueado('a resposta mudou depois da aprovação');
    }

    // 3. O cliente não escreveu depois do rascunho (hora da mensagem ou hora em que chegou ao sistema).
    const dm = await c.query(
      `SELECT d.conversa_id, cv.jid FROM demandas d LEFT JOIN conversas cv ON cv.id = d.conversa_id WHERE d.id = $1`,
      [Number(r.demanda_id)],
    );
    if (dm.rows[0].conversa_id === null) return bloqueado('destino diferente da conversa de origem');
    const depois = await c.query(
      `SELECT 1 FROM mensagens
        WHERE conversa_id = $1 AND de_mim = false AND (recebida_em > $2 OR criado_em > $2) LIMIT 1`,
      [Number(dm.rows[0].conversa_id), r.criado_em],
    );
    if (depois.rows.length > 0) return bloqueado('o cliente escreveu depois da resposta pronta');

    // 4. O destino é a conversa de origem da demanda.
    if (r.destino !== dm.rows[0].jid) return bloqueado('destino diferente da conversa de origem');

    // 5. Idempotência: a chave é única por versão do rascunho.
    const chave = `rascunho-${Number(r.id)}-v${Number(r.versao)}`;
    const ins = await c.query(
      `INSERT INTO envios (chave, rascunho_id, destino, estado) VALUES ($1, $2, $3, 'enviando')
       ON CONFLICT (chave) DO NOTHING RETURNING id`,
      [chave, Number(r.id), r.destino],
    );
    if (ins.rows.length > 0) return { envioId: Number(ins.rows[0].id), destino: r.destino, texto: r.texto };

    // A chave já existe: o que fazer depende de como terminou a tentativa anterior.
    const anterior = await c.query(`SELECT estado FROM envios WHERE chave = $1`, [chave]);
    const estado: string = anterior.rows[0].estado;
    if (estado === 'falhou') {
      // Falha certa (a mensagem não saiu): reabre a mesma linha e tenta de novo.
      const reaberto = await c.query(
        `UPDATE envios SET estado = 'enviando', erro = NULL WHERE chave = $1 AND estado = 'falhou' RETURNING id`,
        [chave],
      );
      return { envioId: Number(reaberto.rows[0].id), destino: r.destino, texto: r.texto };
    }
    if (estado === 'enviando') {
      return bloqueado(`envio incerto em aberto — confira no WhatsApp; para reenviar, use "${Number(r.demanda_id)} muda: ..."`);
    }
    return bloqueado('esta resposta já foi enviada');
  });
}

export async function enviarAprovado(
  db: Db,
  canal: CanalWhatsApp,
  aprovacaoId: number,
  agora: Date = new Date(),
): Promise<ResultadoEnvio> {
  const reserva = await reservar(db, aprovacaoId, agora);
  if ('tipo' in reserva) return reserva;

  // Só o envio fica no try: uma mensagem que já saiu nunca vira 'falhou'.
  let id: string | null;
  try {
    ({ id } = await canal.enviarTexto(reserva.destino, reserva.texto));
  } catch (e) {
    const detalhe = e instanceof Error ? e.message : String(e);
    if (e instanceof ErroEnvioIncerto) {
      // A linha continua 'enviando': pode ter saído.
      return { tipo: 'falhou', erro: `incerto: ${detalhe} — confira no WhatsApp antes de tentar de novo` };
    }
    await db.query(`UPDATE envios SET estado = 'falhou', erro = $2 WHERE id = $1`, [reserva.envioId, detalhe]);
    return { tipo: 'falhou', erro: detalhe };
  }
  // Se este UPDATE falhar, o erro sobe e a linha fica 'enviando'.
  await db.query(`UPDATE envios SET estado = 'enviado', whatsapp_msg_id = $2, enviado_em = now() WHERE id = $1`, [
    reserva.envioId,
    id,
  ]);
  return { tipo: 'enviado' };
}
