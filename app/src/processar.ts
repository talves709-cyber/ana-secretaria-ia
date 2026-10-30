import type { Db } from './db.js';
import { normalizarMensagens, type MensagemNormalizada } from './normalizar.js';
import { ehComandoDoDono } from './conversa-dono.js';
import { gravarEstadoConexao, gravarMensagem, lerEvento, marcarEvento } from './repositorio.js';

/** JIDs @lid já avisados nesta execução: o aviso sai uma vez por JID. */
const lidsAvisados = new Set<string>();

/**
 * O WhatsApp pode entregar a conversa do Thiago consigo mesmo num JID @lid, que não dá para deduzir do número.
 * Mensagem dele numa conversa @lid desconhecida gera um aviso no log com o JID para pôr em DONO_JIDS_EXTRA.
 */
function avisarLidDesconhecido(m: MensagemNormalizada, jidsDoDono: string[]): void {
  const jid = m.conversaJid;
  if (!m.deMim || m.conversaTipo !== 'individual' || !jid.endsWith('@lid') || jidsDoDono.includes(jid) || lidsAvisados.has(jid)) return;
  lidsAvisados.add(jid);
  console.warn(`mensagem sua numa conversa @lid não reconhecida: ${jid} — se for a conversa com você mesmo, ponha em DONO_JIDS_EXTRA`);
}

/** Processa um evento já gravado. Lança erro para o BullMQ tentar de novo. */
export async function processarEvento(
  db: Db,
  eventoId: number,
  agendarClassificacao?: (conversaId: number) => Promise<void>,
  comandos?: { jids: string[]; enfileirar(mensagemId: number): Promise<void> },
): Promise<void> {
  const evento = await lerEvento(db, eventoId);
  if (!evento) return;
  try {
    const data = evento.payload?.data;
    switch (evento.evento) {
      case 'messages.upsert':
        for (const m of normalizarMensagens(data)) {
          const gravada = await gravarMensagem(db, m, eventoId);
          if (gravada && comandos) avisarLidDesconhecido(m, comandos.jids);
          // Mensagem do dono vai para a fila de comandos (a conversa dele está em modo 'comando', então
          // não é classificada). O eco "Ana: ..." não é comando: só fica gravado.
          if (gravada && comandos && ehComandoDoDono(m, comandos.jids)) {
            await comandos.enfileirar(gravada.id);
          } else if (gravada?.modo === 'classificar' && agendarClassificacao) {
            await agendarClassificacao(gravada.conversaId);
          }
        }
        break;
      case 'connection.update':
        if (typeof data?.state === 'string') await gravarEstadoConexao(db, evento.instancia, data.state);
        break;
      default:
        // Outros eventos ficam só guardados em eventos_webhook por enquanto.
        break;
    }
    await marcarEvento(db, eventoId, null);
  } catch (erro) {
    await marcarEvento(db, eventoId, (erro as Error).message);
    throw erro;
  }
}
