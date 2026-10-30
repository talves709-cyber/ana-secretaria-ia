import { timingSafeEqual } from 'node:crypto';
import cookie from '@fastify/cookie';
import formbody from '@fastify/formbody';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { QrCode } from './evolution.js';
import type { LinhaClassificada, ResumoDiario, ResumoMensagens } from './repositorio.js';
import { criarSessao, LimiteTentativas, sessaoValida, VALIDADE_SESSAO_MS } from './sessao.js';

export interface DepsPainel {
  senha: string;
  /** Segredo que assina o cookie de sessão (SESSAO_SEGREDO). */
  sessaoSegredo: string;
  /** Garante que a instância existe e devolve o estado ("open", "connecting", "close"...). */
  estado: () => Promise<string>;
  qrCode: () => Promise<QrCode>;
  resumo: () => Promise<ResumoMensagens>;
  resumoDiario: () => Promise<ResumoDiario>;
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
export function paginaPainel(r: ResumoDiario): string {
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
<p class="dica"><a href="/conexao">Ver estado da conexão</a> · atualiza a cada 2 min.</p>`;
  return pagina(corpo, 120);
}

const COOKIE_SESSAO = 'ana_sessao';

function senhaConfere(recebida: string, senha: string): boolean {
  const a = Buffer.from(recebida);
  const b = Buffer.from(senha);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Só aceita caminhos do próprio site: começa com "/" e não com "//" nem barra seguida de contrabarra (redirecionamento aberto). */
function destinoSeguro(volta: unknown): string {
  if (typeof volta !== 'string' || !volta.startsWith('/') || volta.startsWith('//') || volta.startsWith('/\\')) {
    return '/painel';
  }
  return volta;
}

/** Devolve true se há sessão válida; senão redireciona para /entrar?volta=<caminho> e devolve false. */
export function exigirSessao(req: FastifyRequest, reply: FastifyReply, segredo: string): boolean {
  if (sessaoValida(req.cookies[COOKIE_SESSAO], segredo)) return true;
  reply.redirect(`/entrar?volta=${encodeURIComponent(req.url)}`);
  return false;
}

function paginaLogin(volta: string, erro?: string): string {
  const aviso = erro ? `<p style="color:#c5221f">${escapar(erro)}</p>` : '';
  return pagina(`<h2 style="text-align:center">Entrar</h2>${aviso}
<form method="post" action="/entrar">
<input type="hidden" name="volta" value="${escapar(volta)}">
<p><input type="password" name="senha" placeholder="Senha" autocomplete="current-password" autofocus required style="padding:8px;width:100%;max-width:260px"></p>
<p><button type="submit" style="padding:8px 20px">Entrar</button></p>
</form>`);
}

export function pagina(corpo: string, recarregarEm?: number): string {
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

/** Rotas do painel, protegidas por login com cookie de sessão assinado. */
export function registrarPainel(app: FastifyInstance, deps: DepsPainel) {
  app.register(cookie);
  app.register(formbody);
  const limite = new LimiteTentativas();

  app.get('/entrar', async (req, reply) => {
    const { volta } = req.query as { volta?: string };
    reply.type('text/html; charset=utf-8').header('cache-control', 'no-store');
    return paginaLogin(destinoSeguro(volta));
  });

  app.post('/entrar', async (req, reply) => {
    const corpo = (req.body ?? {}) as { senha?: unknown; volta?: unknown };
    reply.type('text/html; charset=utf-8').header('cache-control', 'no-store');
    if (limite.bloqueado(req.ip)) {
      return reply.code(429).send(paginaLogin(destinoSeguro(corpo.volta), 'Muitas tentativas. Aguarde 15 minutos.'));
    }
    if (typeof corpo.senha !== 'string' || !senhaConfere(corpo.senha, deps.senha)) {
      limite.falhou(req.ip);
      return reply.code(401).send(paginaLogin(destinoSeguro(corpo.volta), 'Senha incorreta.'));
    }
    limite.limpar(req.ip);
    reply.setCookie(COOKIE_SESSAO, criarSessao(deps.sessaoSegredo), {
      httpOnly: true,
      secure: true,
      sameSite: 'strict',
      path: '/',
      maxAge: VALIDADE_SESSAO_MS / 1000,
    });
    return reply.redirect(destinoSeguro(corpo.volta));
  });

  app.post('/sair', async (_req, reply) => {
    reply.clearCookie(COOKIE_SESSAO, { path: '/' });
    return reply.redirect('/entrar');
  });

  app.get('/conexao', async (req, reply) => {
    if (!exigirSessao(req, reply, deps.sessaoSegredo)) return reply;
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
    if (!exigirSessao(req, reply, deps.sessaoSegredo)) return reply;
    reply.type('text/html; charset=utf-8').header('cache-control', 'no-store');
    return paginaPainel(await deps.resumoDiario());
  });
}
