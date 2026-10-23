import { timingSafeEqual } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { QrCode } from './evolution.js';

export interface DepsPainel {
  senha: string;
  /** Garante que a instância existe e devolve o estado ("open", "connecting", "close"...). */
  estado: () => Promise<string>;
  qrCode: () => Promise<QrCode>;
}

function senhaConfere(cabecalho: string | undefined, senha: string): boolean {
  if (!cabecalho?.startsWith('Basic ')) return false;
  const decodificado = Buffer.from(cabecalho.slice(6), 'base64').toString('utf8');
  const recebida = Buffer.from(decodificado.slice(decodificado.indexOf(':') + 1));
  const esperada = Buffer.from(senha);
  return recebida.length === esperada.length && timingSafeEqual(recebida, esperada);
}

function pagina(corpo: string, recarregarEm?: number): string {
  const meta = recarregarEm ? `<meta http-equiv="refresh" content="${recarregarEm}">` : '';
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">${meta}<title>Ana · Conexão</title>
<style>body{font-family:system-ui,sans-serif;max-width:420px;margin:40px auto;padding:0 16px;text-align:center;color:#222}
img{width:100%;max-width:320px;border:1px solid #ddd;border-radius:8px}.ok{color:#137333}.dica{color:#666;font-size:14px}</style>
</head><body><h1>Ana</h1>${corpo}</body></html>`;
}

/** Página protegida por senha para ver o estado da conexão e ler o QR Code no navegador. */
export function registrarPainel(app: FastifyInstance, deps: DepsPainel) {
  app.get('/conexao', async (req, reply) => {
    if (!senhaConfere(req.headers.authorization, deps.senha)) {
      return reply.code(401).header('www-authenticate', 'Basic realm="Ana", charset="UTF-8"').send('Senha necessária');
    }
    reply.type('text/html; charset=utf-8').header('cache-control', 'no-store');

    const estado = await deps.estado();
    if (estado === 'open') {
      return pagina('<p class="ok"><strong>WhatsApp conectado.</strong></p><p class="dica">As mensagens já estão sendo gravadas.</p>', 60);
    }
    const qr = await deps.qrCode();
    if (!qr.base64) {
      return pagina(`<p>Estado: ${estado}. Gerando o QR Code...</p>`, 5);
    }
    const pareamento = qr.pairingCode ? `<p class="dica">Ou use o código: <strong>${qr.pairingCode}</strong></p>` : '';
    return pagina(
      `<p>No celular: WhatsApp &gt; Aparelhos conectados &gt; Conectar aparelho.</p>
<img src="${qr.base64}" alt="QR Code do WhatsApp">${pareamento}
<p class="dica">A página atualiza sozinha a cada 20 segundos.</p>`,
      20,
    );
  });
}
