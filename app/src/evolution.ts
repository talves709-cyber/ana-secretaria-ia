/** Cliente mínimo da API REST do Evolution API v2. */

export const EVENTOS_WEBHOOK = [
  'MESSAGES_UPSERT',
  'MESSAGES_UPDATE',
  'CONTACTS_UPSERT',
  'CHATS_UPSERT',
  'CONNECTION_UPDATE',
  'QRCODE_UPDATED',
] as const;

export interface QrCode {
  base64?: string;
  code?: string;
  pairingCode?: string | null;
}

export class Evolution {
  constructor(
    private readonly url: string,
    private readonly apiKey: string,
  ) {}

  private async chamar<T>(metodo: string, caminho: string, corpo?: unknown): Promise<T> {
    const resposta = await fetch(`${this.url}${caminho}`, {
      method: metodo,
      headers: { apikey: this.apiKey, 'content-type': 'application/json' },
      body: corpo === undefined ? undefined : JSON.stringify(corpo),
    });
    const texto = await resposta.text();
    if (!resposta.ok) throw new Error(`Evolution ${metodo} ${caminho} → ${resposta.status}: ${texto}`);
    return (texto ? JSON.parse(texto) : {}) as T;
  }

  criarInstancia(nome: string, webhookUrl: string, webhookToken: string) {
    return this.chamar<{ qrcode?: QrCode }>('POST', '/instance/create', {
      instanceName: nome,
      integration: 'WHATSAPP-BAILEYS',
      qrcode: true,
      webhook: {
        enabled: true,
        url: webhookUrl,
        headers: { 'x-ana-token': webhookToken },
        byEvents: false,
        base64: false,
        events: EVENTOS_WEBHOOK,
      },
    });
  }

  configurarWebhook(nome: string, webhookUrl: string, webhookToken: string) {
    return this.chamar('POST', `/webhook/set/${encodeURIComponent(nome)}`, {
      webhook: {
        enabled: true,
        url: webhookUrl,
        headers: { 'x-ana-token': webhookToken },
        byEvents: false,
        base64: false,
        events: EVENTOS_WEBHOOK,
      },
    });
  }

  conectar(nome: string) {
    return this.chamar<QrCode>('GET', `/instance/connect/${encodeURIComponent(nome)}`);
  }

  async estado(nome: string): Promise<string> {
    const r = await this.chamar<{ instance?: { state?: string } }>(
      'GET',
      `/instance/connectionState/${encodeURIComponent(nome)}`,
    );
    return r.instance?.state ?? 'desconhecido';
  }
}
