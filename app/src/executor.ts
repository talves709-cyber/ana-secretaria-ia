/**
 * Executor de envio: o único caminho pelo qual uma resposta sai para um cliente.
 * Só envia com aprovação válida e revalida tudo no momento do envio.
 */
import { createHash } from 'node:crypto';
import type { Db } from './db.js';

export type ResultadoEnvio = { tipo: 'enviado' } | { tipo: 'bloqueado'; motivo: string } | { tipo: 'falhou'; erro: string };

export interface CanalWhatsApp {
  enviarTexto(jid: string, texto: string): Promise<{ id: string }>;
}

const VALIDADE_APROVACAO_MS = 24 * 60 * 60 * 1000;

function bloqueado(motivo: string): ResultadoEnvio {
  return { tipo: 'bloqueado', motivo };
}

export async function enviarAprovado(
  db: Db,
  canal: CanalWhatsApp,
  aprovacaoId: number,
  agora: Date = new Date(),
): Promise<ResultadoEnvio> {
  // 1. Aprovação existe e tem menos de 24 h.
  const ap = await db.query(`SELECT rascunho_id, hash, criado_em FROM aprovacoes WHERE id = $1`, [aprovacaoId]);
  if (ap.rows.length === 0) return bloqueado('aprovação vencida');
  const aprovadaEm = new Date(ap.rows[0].criado_em).getTime();
  if (agora.getTime() - aprovadaEm >= VALIDADE_APROVACAO_MS) return bloqueado('aprovação vencida');

  // 2. O rascunho aprovado é a versão atual da demanda e o hash confere.
  const rs = await db.query(
    `SELECT r.id, r.demanda_id, r.versao, r.texto, r.destino, r.hash, r.criado_em,
            (SELECT max(versao) FROM rascunhos WHERE demanda_id = r.demanda_id) AS versao_atual
       FROM rascunhos r WHERE r.id = $1`,
    [Number(ap.rows[0].rascunho_id)],
  );
  if (rs.rows.length === 0) return bloqueado('a resposta mudou depois da aprovação');
  const r = rs.rows[0];
  const hashAtual = createHash('sha256').update(`${r.destino}\n${r.texto}`).digest('hex');
  if (Number(r.versao) !== Number(r.versao_atual) || r.hash !== ap.rows[0].hash || r.hash !== hashAtual) {
    return bloqueado('a resposta mudou depois da aprovação');
  }

  // 3. O cliente não escreveu depois do rascunho.
  const dm = await db.query(`SELECT d.conversa_id, c.jid FROM demandas d LEFT JOIN conversas c ON c.id = d.conversa_id WHERE d.id = $1`, [
    Number(r.demanda_id),
  ]);
  if (dm.rows.length === 0 || dm.rows[0].conversa_id === null) return bloqueado('destino diferente da conversa de origem');
  const depois = await db.query(
    `SELECT 1 FROM mensagens WHERE conversa_id = $1 AND de_mim = false AND recebida_em > $2 LIMIT 1`,
    [Number(dm.rows[0].conversa_id), r.criado_em],
  );
  if (depois.rows.length > 0) return bloqueado('o cliente escreveu depois da resposta pronta');

  // 4. O destino é a conversa de origem da demanda.
  if (r.destino !== dm.rows[0].jid) return bloqueado('destino diferente da conversa de origem');

  // 5. Idempotência: a chave é única por versão do rascunho.
  const chave = `rascunho-${Number(r.id)}-v${Number(r.versao)}`;
  const ins = await db.query(
    `INSERT INTO envios (chave, rascunho_id, destino, estado) VALUES ($1, $2, $3, 'enviando')
     ON CONFLICT (chave) DO NOTHING RETURNING id`,
    [chave, Number(r.id), r.destino],
  );
  if (ins.rows.length === 0) return bloqueado('esta resposta já foi enviada');
  const envioId = Number(ins.rows[0].id);

  try {
    const { id } = await canal.enviarTexto(r.destino, r.texto);
    await db.query(`UPDATE envios SET estado = 'enviado', whatsapp_msg_id = $2, enviado_em = now() WHERE id = $1`, [envioId, id]);
    return { tipo: 'enviado' };
  } catch (e) {
    const erro = e instanceof Error ? e.message : String(e);
    await db.query(`UPDATE envios SET estado = 'falhou', erro = $2 WHERE id = $1`, [envioId, erro]);
    return { tipo: 'falhou', erro };
  }
}
