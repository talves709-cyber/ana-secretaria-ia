import { describe, expect, it } from 'vitest';
import { nomeDoEvento, normalizarMensagens } from '../src/normalizar.js';

describe('nomeDoEvento', () => {
  it('aceita os formatos que o Evolution usa', () => {
    expect(nomeDoEvento('MESSAGES_UPSERT')).toBe('messages.upsert');
    expect(nomeDoEvento('messages.upsert')).toBe('messages.upsert');
    expect(nomeDoEvento('messages-upsert')).toBe('messages.upsert');
  });
});

describe('normalizarMensagens', () => {
  it('lê texto simples de conversa individual', () => {
    const [m] = normalizarMensagens({
      key: { remoteJid: '5511999990000@s.whatsapp.net', fromMe: false, id: 'ABC' },
      pushName: 'Maria',
      message: { conversation: 'Bom dia, segue o orçamento' },
      messageType: 'conversation',
      messageTimestamp: 1761220000,
    });
    expect(m).toMatchObject({
      whatsappMsgId: 'ABC',
      conversaTipo: 'individual',
      remetenteJid: '5511999990000@s.whatsapp.net',
      remetenteNome: 'Maria',
      deMim: false,
      texto: 'Bom dia, segue o orçamento',
    });
    expect(m!.recebidaEm.toISOString()).toBe('2025-10-23T11:46:40.000Z');
  });

  it('usa o participante como remetente em grupo', () => {
    const [m] = normalizarMensagens({
      key: { remoteJid: '1203630@g.us', fromMe: false, id: 'G1', participant: '5521888880000@s.whatsapp.net' },
      message: { extendedTextMessage: { text: 'Reunião às 15h' } },
    });
    expect(m).toMatchObject({ conversaTipo: 'grupo', remetenteJid: '5521888880000@s.whatsapp.net', texto: 'Reunião às 15h' });
  });

  it('lê legenda de imagem dentro de mensagem temporária', () => {
    const [m] = normalizarMensagens({
      key: { remoteJid: '5511@s.whatsapp.net', fromMe: true, id: 'E1' },
      message: { ephemeralMessage: { message: { imageMessage: { caption: 'Nota fiscal' } } } },
    });
    expect(m).toMatchObject({ tipo: 'imageMessage', texto: 'Nota fiscal', deMim: true, remetenteJid: null });
  });

  it('ignora status e itens sem id, e aceita lista', () => {
    const r = normalizarMensagens([
      { key: { remoteJid: 'status@broadcast', id: 'S' }, message: { conversation: 'x' } },
      { key: { remoteJid: '5511@s.whatsapp.net' } },
      { key: { remoteJid: '5511@s.whatsapp.net', id: 'OK' }, message: { audioMessage: {} } },
    ]);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ whatsappMsgId: 'OK', tipo: 'audioMessage', texto: null });
  });
});
