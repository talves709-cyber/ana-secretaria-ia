import { timingSafeEqual } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { QrCode } from './evolution.js';
import type { LinhaClassificada, ResumoDiario, ResumoMensagens, RetencaoResumo } from './repositorio.js';

export interface DepsPainel {
  senha: string;
  /** Garante que a instância existe e devolve o estado ("open", "connecting", "close"...). */
  estado: () => Promise<string>;
  qrCode: () => Promise<QrCode>;
  resumo: () => Promise<ResumoMensagens>;
  resumoDiario: () => Promise<ResumoDiario>;
  retencao: () => Promise<RetencaoResumo>;
}

/** Texto de mensagem vem de terceiros: sempre escapar antes de pôr no HTML. */
export function escapar(texto: string): string {
  return texto.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

const hora = new Intl.DateTimeFormat('pt-BR', {
  timeZone: 'America/Sao_Paulo',
  day: '2-digit',
  month: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
});

function tabelaResumo(r: ResumoMensagens): string {
  const linhas = r.ultimas
    .map((m) => {
      const texto = m.texto ? escapar(m.texto.slice(0, 80)) : `<em>${escapar(m.tipo)}</em>`;
      const quem = m.deMim ? 'você → ' : '';
      return `<tr><td>${hora.format(m.recebidaEm)}</td><td>${quem}${escapar(m.conversa)}</td><td>${texto}</td></tr>`;
    })
    .join('');
  return `<p><strong>${r.hoje}</strong> mensagens hoje · <strong>${r.total}</strong> no total</p>
<table><thead><tr><th>Quando</th><th>Conversa</th><th>Mensagem</th></tr></thead><tbody>${linhas}</tbody></table>`;
}

const PRIORIDADE_COR: Record<string, string> = {
  urgente: '#c5221f',
  alta: '#e8710a',
  media: '#1a73e8',
  baixa: '#5f6368',
};

function etiquetaPrioridade(p: string | null): string {
  if (!p) return '';
  return `<span class="tag" style="background:${PRIORIDADE_COR[p] ?? '#5f6368'}">${escapar(p)}</span>`;
}

function confiancaPct(c: number | null): string {
  return c === null ? '—' : `${Math.round(c * 100)}%`;
}

function linhaClassificada(m: LinhaClassificada): string {
  const assunto = m.resumo ? escapar(m.resumo) : m.texto ? escapar(m.texto.slice(0, 90)) : `<em>${escapar(m.tipo)}</em>`;
  const empresa = m.empresa ? escapar(m.empresa) : '<em>—</em>';
  const categoria = m.categoria ? escapar(m.categoria) : '<em>—</em>';
  return `<tr><td>${hora.format(m.recebidaEm)}</td><td>${escapar(m.conversa)}</td>
<td><strong>${empresa}</strong><br><span class="dica">${categoria}</span></td>
<td>${etiquetaPrioridade(m.prioridade)} ${assunto}</td><td class="num">${confiancaPct(m.confianca)}</td></tr>`;
}

function listaContagem(itens: { nome: string; total: number }[]): string {
  if (!itens.length) return '<p class="dica">Nada ainda hoje.</p>';
  return `<ul class="chips">${itens
    .map((i) => `<li>${escapar(i.nome)} <strong>${i.total}</strong></li>`)
    .join('')}</ul>`;
}

function tabela(titulo: string, linhas: LinhaClassificada[], vazio: string): string {
  if (!linhas.length) return `<h2>${titulo}</h2><p class="dica">${vazio}</p>`;
  const corpo = linhas.map(linhaClassificada).join('');
  return `<h2>${titulo}</h2><table><thead><tr><th>Quando</th><th>Conversa</th><th>Empresa / categoria</th><th>Assunto</th><th class="num">Conf.</th></tr></thead><tbody>${corpo}</tbody></table>`;
}

/** Monta a página /painel a partir do resumo do dia. Função pura, para testar o HTML. */
function blocoRetencao(t: RetencaoResumo): string {
  const data = t.maisAntiga ? hora.format(t.maisAntiga) : '—';
  const veredito =
    t.antigas === 0
      ? `<p class="ok"><strong>Nada com mais de ${t.limiteMeses} meses.</strong></p>`
      : `<p><strong>Não apague nada ainda.</strong> Por enquanto a Ana só mostra o que existe; a exclusão automática não está ligada.</p>`;
  return `<h2>Retenção (mais de ${t.limiteMeses} meses)</h2>${veredito}
<table><tbody>
<tr><td>Mensagens com mais de ${t.limiteMeses} meses</td><td class="num"><strong>${t.antigas}</strong></td></tr>
<tr><td>Já podem ser apagadas (classificadas com confiança)</td><td class="num">${t.podeApagar}</td></tr>
<tr><td>Manter: aguardam revisão</td><td class="num">${t.revisar}</td></tr>
<tr><td>Manter: ainda sem classificação</td><td class="num">${t.semClassificacao}</td></tr>
<tr><td>Mensagem mais antiga</td><td class="num">${data}</td></tr>
</tbody></table>`;
}

export function paginaPainel(r: ResumoDiario, retencao?: RetencaoResumo): string {
  const empresas = listaContagem(r.porEmpresa.map((e) => ({ nome: e.empresa, total: e.total })));
  const categorias = listaContagem(r.porCategoria.map((c) => ({ nome: c.categoria, total: c.total })));
  const sugestoes = r.sugestoes.length
    ? `<h2>Empresas sugeridas</h2><p class="dica">A Ana viu contatos que podem ser novas empresas:</p>${listaContagem(
        r.sugestoes.map((s) => ({ nome: s.nome, total: s.qtd })),
      )}`
    : '';
  const corpo = `<p><strong>${r.totalHoje}</strong> mensagens classificadas hoje (${escapar(r.dia)})</p>
<h2>Por empresa</h2>${empresas}
<h2>Por categoria</h2>${categorias}
${tabela('Precisa de revisão', r.revisao, 'Nada pendente de revisão. 👍')}
${tabela('Últimas classificações', r.recentes, 'Nenhuma mensagem classificada ainda.')}
${sugestoes}
${retencao ? blocoRetencao(retencao) : ''}
<p class="dica"><a href="/conexao">Ver estado da conexão</a> · atualiza a cada 2 min.</p>`;
  return pagina(corpo, 120);
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
<style>body{font-family:system-ui,sans-serif;max-width:720px;margin:40px auto;padding:0 16px;text-align:center;color:#222}
img{width:100%;max-width:320px;border:1px solid #ddd;border-radius:8px}
table{width:100%;border-collapse:collapse;font-size:13px;text-align:left}td,th{padding:6px 4px;border-bottom:1px solid #eee;vertical-align:top;word-break:break-word}.ok{color:#137333}.dica{color:#666;font-size:14px}
h2{font-size:16px;margin:24px 0 8px;text-align:left}.num{text-align:right;white-space:nowrap}
.tag{color:#fff;border-radius:4px;padding:1px 6px;font-size:11px;text-transform:uppercase}
ul.chips{list-style:none;padding:0;margin:0;display:flex;flex-wrap:wrap;gap:6px;text-align:left}
ul.chips li{background:#f1f3f4;border-radius:14px;padding:4px 10px;font-size:13px}</style>
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
      const resumo = await deps.resumo();
      return pagina(`<p class="ok"><strong>WhatsApp conectado.</strong></p>${tabelaResumo(resumo)}`, 60);
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

  app.get('/painel', async (req, reply) => {
    if (!senhaConfere(req.headers.authorization, deps.senha)) {
      return reply.code(401).header('www-authenticate', 'Basic realm="Ana", charset="UTF-8"').send('Senha necessária');
    }
    reply.type('text/html; charset=utf-8').header('cache-control', 'no-store');
    const [resumo, retencao] = await Promise.all([deps.resumoDiario(), deps.retencao()]);
    return paginaPainel(resumo, retencao);
  });
}
