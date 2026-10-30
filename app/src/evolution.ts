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

const TIMEOUT_MS = 30_000;

/** Envio sem resposta (rede/timeout): a mensagem pode ou não ter saído. */
export class ErroEnvioIncerto extends Error {}

export class ErroEvolution extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
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
    if (!resposta.ok) {
      throw new ErroEvolution(`Evolution ${metodo} ${caminho} → ${resposta.status}: ${texto}`, resposta.status);
    }
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

  /**
   * Envia texto a um número ou, em grupo, ao JID do grupo.
   * - resposta HTTP de erro: ErroEvolution (falha certa, nada saiu);
   * - rede/timeout sem resposta: ErroEnvioIncerto (pode ter saído);
   * - 2xx: enviado; id nulo se a resposta não trouxer key.id ou vier inválida.
   */
  async enviarTexto(instancia: string, numero: string, texto: string): Promise<{ id: string | null }> {
    const caminho = `/message/sendText/${encodeURIComponent(instancia)}`;
    let resposta: Response;
    let corpo: string;
    try {
      resposta = await fetch(`${this.url}${caminho}`, {
        method: 'POST',
        headers: { apikey: this.apiKey, 'content-type': 'application/json' },
        body: JSON.stringify({ number: numero, text: texto }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      corpo = await resposta.text();
    } catch (erro) {
      throw new ErroEnvioIncerto(erro instanceof Error ? erro.message : String(erro));
    }
    if (!resposta.ok) {
      throw new ErroEvolution(`Evolution POST ${caminho} → ${resposta.status}: ${corpo}`, resposta.status);
    }
    try {
      const id = (JSON.parse(corpo) as { key?: { id?: unknown } }).key?.id;
      return { id: typeof id === 'string' && id ? id : null };
    } catch {
      return { id: null };
    }
  }

  /** Cria a instância com o webhook se ela ainda não existir. Devolve o estado atual. */
  async garantirInstancia(nome: string, webhookUrl: string, webhookToken: string): Promise<string> {
    try {
      return await this.estado(nome);
    } catch (erro) {
      if (!(erro instanceof ErroEvolution) || erro.status !== 404) throw erro;
      await this.criarInstancia(nome, webhookUrl, webhookToken);
      return 'criada';
    }
  }
}
