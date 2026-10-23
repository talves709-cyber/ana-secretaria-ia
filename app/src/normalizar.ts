/** Converte o payload de messages.upsert do Evolution numa mensagem simples. Função pura. */

export interface MensagemNormalizada {
  whatsappMsgId: string;
  conversaJid: string;
  conversaTipo: 'individual' | 'grupo';
  remetenteJid: string | null;
  remetenteNome: string | null;
  deMim: boolean;
  tipo: string;
  texto: string | null;
  recebidaEm: Date;
}

type Qualquer = Record<string, any>;

/** "MESSAGES_UPSERT", "messages.upsert" e "messages-upsert" viram "messages.upsert". */
export function nomeDoEvento(evento: string): string {
  return evento.toLowerCase().replace(/[_-]/g, '.');
}

/** Desembrulha mensagens temporárias, de visualização única e editadas. */
function conteudo(message: Qualquer | undefined): Qualquer {
  let m = message ?? {};
  for (let i = 0; i < 3; i++) {
    const interno =
      m.ephemeralMessage?.message ??
      m.viewOnceMessage?.message ??
      m.viewOnceMessageV2?.message ??
      m.documentWithCaptionMessage?.message;
    if (!interno) break;
    m = interno;
  }
  return m;
}

function extrairTexto(m: Qualquer): string | null {
  const texto =
    m.conversation ??
    m.extendedTextMessage?.text ??
    m.imageMessage?.caption ??
    m.videoMessage?.caption ??
    m.documentMessage?.caption ??
    m.documentMessage?.fileName ??
    m.buttonsResponseMessage?.selectedDisplayText ??
    m.listResponseMessage?.title ??
    null;
  return typeof texto === 'string' && texto.trim() ? texto : null;
}

function extrairTipo(item: Qualquer, m: Qualquer): string {
  if (typeof item.messageType === 'string') return item.messageType;
  const chave = Object.keys(m).find((k) => k.endsWith('Message') || k === 'conversation');
  return chave ?? 'desconhecido';
}

function extrairData(valor: unknown): Date {
  const n =
    typeof valor === 'number' ? valor
    : typeof valor === 'string' ? Number(valor)
    : typeof valor === 'object' && valor !== null && 'low' in valor ? Number((valor as Qualquer).low)
    : NaN;
  return Number.isFinite(n) && n > 0 ? new Date(n * 1000) : new Date();
}

/** Devolve as mensagens do evento, ignorando status (stories) e itens sem id. */
export function normalizarMensagens(data: unknown): MensagemNormalizada[] {
  const itens: Qualquer[] = Array.isArray(data)
    ? data
    : Array.isArray((data as Qualquer)?.messages)
      ? (data as Qualquer).messages
      : data
        ? [data as Qualquer]
        : [];
  const resultado: MensagemNormalizada[] = [];
  for (const item of itens) {
    const key = item?.key;
    const jid: unknown = key?.remoteJid;
    if (typeof jid !== 'string' || typeof key?.id !== 'string') continue;
    if (jid === 'status@broadcast' || jid.endsWith('@newsletter')) continue;

    const grupo = jid.endsWith('@g.us');
    const deMim = Boolean(key.fromMe);
    const m = conteudo(item.message);
    resultado.push({
      whatsappMsgId: key.id,
      conversaJid: jid,
      conversaTipo: grupo ? 'grupo' : 'individual',
      remetenteJid: deMim ? null : grupo ? (key.participant ?? item.participant ?? null) : jid,
      remetenteNome: deMim ? null : (item.pushName ?? null),
      deMim,
      tipo: extrairTipo(item, m),
      texto: extrairTexto(m),
      recebidaEm: extrairData(item.messageTimestamp),
    });
  }
  return resultado;
}
