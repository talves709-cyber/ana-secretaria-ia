import type { Db } from './db.js';
import type { MensagemNormalizada } from './normalizar.js';

export async function gravarEvento(db: Db, instancia: string, evento: string, payload: unknown) {
  const r = await db.query<{ id: string }>(
    'INSERT INTO eventos_webhook (instancia, evento, payload) VALUES ($1, $2, $3) RETURNING id',
    [instancia, evento, JSON.stringify(payload)],
  );
  return Number(r.rows[0]!.id);
}

export async function lerEvento(db: Db, id: number) {
  const r = await db.query<{ instancia: string; evento: string; payload: any }>(
    'SELECT instancia, evento, payload FROM eventos_webhook WHERE id = $1',
    [id],
  );
  return r.rows[0];
}

export async function marcarEvento(db: Db, id: number, erro: string | null) {
  await db.query(
    'UPDATE eventos_webhook SET processado_em = CASE WHEN $2::text IS NULL THEN now() END, erro = $2 WHERE id = $1',
    [id, erro],
  );
}

async function garantirContato(db: Db, jid: string, nome: string | null): Promise<number> {
  const r = await db.query<{ id: string }>(
    `INSERT INTO contatos (jid, nome) VALUES ($1, $2)
     ON CONFLICT (jid) DO UPDATE SET nome = COALESCE(EXCLUDED.nome, contatos.nome), atualizado_em = now()
     RETURNING id`,
    [jid, nome],
  );
  return Number(r.rows[0]!.id);
}

async function garantirConversa(
  db: Db,
  jid: string,
  tipo: 'individual' | 'grupo',
  contatoId: number | null,
): Promise<{ id: number; modo: string }> {
  const r = await db.query<{ id: string; modo: string }>(
    `INSERT INTO conversas (jid, tipo, contato_id) VALUES ($1, $2, $3)
     ON CONFLICT (jid) DO UPDATE SET contato_id = COALESCE(conversas.contato_id, EXCLUDED.contato_id)
     RETURNING id, modo`,
    [jid, tipo, contatoId],
  );
  return { id: Number(r.rows[0]!.id), modo: r.rows[0]!.modo };
}

/** Grava a mensagem. Devolve o id novo, ou null se já existia ou a conversa é ignorada. */
export async function gravarMensagem(
  db: Db,
  m: MensagemNormalizada,
  eventoId: number,
): Promise<number | null> {
  const remetenteId = m.remetenteJid ? await garantirContato(db, m.remetenteJid, m.remetenteNome) : null;
  const conversa = await garantirConversa(
    db,
    m.conversaJid,
    m.conversaTipo,
    m.conversaTipo === 'individual' ? remetenteId : null,
  );
  if (conversa.modo === 'ignorar') return null;
  const r = await db.query<{ id: string }>(
    `INSERT INTO mensagens (whatsapp_msg_id, conversa_id, remetente_id, de_mim, tipo, texto, recebida_em, evento_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (conversa_id, whatsapp_msg_id) DO NOTHING
     RETURNING id`,
    [m.whatsappMsgId, conversa.id, remetenteId, m.deMim, m.tipo, m.texto, m.recebidaEm, eventoId],
  );
  return r.rows[0] ? Number(r.rows[0].id) : null;
}

export async function gravarEstadoConexao(db: Db, instancia: string, estado: string) {
  await db.query(
    `INSERT INTO estado_conexao (instancia, estado) VALUES ($1, $2)
     ON CONFLICT (instancia) DO UPDATE SET estado = EXCLUDED.estado, atualizado_em = now()`,
    [instancia, estado],
  );
}
