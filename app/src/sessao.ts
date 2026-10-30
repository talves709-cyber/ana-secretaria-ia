import { createHmac, timingSafeEqual } from 'node:crypto';

/** Validade da sessão do painel: 12 horas. */
export const VALIDADE_SESSAO_MS = 12 * 60 * 60_000;

function assinar(expiraEm: string, segredo: string): string {
  return createHmac('sha256', segredo).update(expiraEm).digest('base64url');
}

/** Token `<expiraEmMs>.<hmac-sha256 base64url>`. */
export function criarSessao(segredo: string, agora: Date = new Date()): string {
  const expiraEm = String(agora.getTime() + VALIDADE_SESSAO_MS);
  return `${expiraEm}.${assinar(expiraEm, segredo)}`;
}

export function sessaoValida(token: string | undefined, segredo: string, agora: Date = new Date()): boolean {
  if (!token) return false;
  const ponto = token.indexOf('.');
  if (ponto < 1) return false;
  const expiraEm = token.slice(0, ponto);
  if (!/^\d+$/.test(expiraEm)) return false;
  const recebida = Buffer.from(token.slice(ponto + 1));
  const esperada = Buffer.from(assinar(expiraEm, segredo));
  if (recebida.length !== esperada.length || !timingSafeEqual(recebida, esperada)) return false;
  return Number(expiraEm) > agora.getTime();
}

/** Limite de tentativas de login por IP, em memória: `max` falhas dentro da janela bloqueiam o IP. */
export class LimiteTentativas {
  /** Teto de IPs guardados, para o Map não crescer sem limite. */
  private static readonly MAX_IPS = 10_000;
  private falhas = new Map<string, number[]>();

  constructor(
    private readonly max = 5,
    private readonly janelaMs = 15 * 60_000,
  ) {}

  private recentes(ip: string, agora: number): number[] {
    const lista = (this.falhas.get(ip) ?? []).filter((t) => agora - t < this.janelaMs);
    if (lista.length) this.falhas.set(ip, lista);
    else this.falhas.delete(ip);
    return lista;
  }

  /** Remove IPs sem falhas na janela; se ainda estiver cheio, descarta o mais antigo. */
  private varrer(agora: number): void {
    for (const ip of [...this.falhas.keys()]) this.recentes(ip, agora);
    if (this.falhas.size >= LimiteTentativas.MAX_IPS) {
      const maisAntigo = this.falhas.keys().next().value;
      if (maisAntigo !== undefined) this.falhas.delete(maisAntigo);
    }
  }

  bloqueado(ip: string, agora: number = Date.now()): boolean {
    return this.recentes(ip, agora).length >= this.max;
  }

  falhou(ip: string, agora: number = Date.now()): void {
    const lista = this.recentes(ip, agora);
    if (!this.falhas.has(ip) && this.falhas.size >= LimiteTentativas.MAX_IPS) this.varrer(agora);
    lista.push(agora);
    this.falhas.set(ip, lista);
  }

  limpar(ip: string): void {
    this.falhas.delete(ip);
  }
}
