-- Modelo de dados da Ana (ver docs/ARQUITETURA.md)

CREATE TABLE segmentos (
  id          bigserial PRIMARY KEY,
  nome        text NOT NULL UNIQUE,
  descricao   text,
  criado_em   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE empresas (
  id              bigserial PRIMARY KEY,
  segmento_id     bigint REFERENCES segmentos(id),
  nome            text NOT NULL UNIQUE,
  apelidos        text[] NOT NULL DEFAULT '{}',
  cnpj            text,
  palavras_chave  text[] NOT NULL DEFAULT '{}',
  criado_em       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE negocios (
  id          bigserial PRIMARY KEY,
  empresa_id  bigint NOT NULL REFERENCES empresas(id),
  nome        text NOT NULL,
  status      text NOT NULL DEFAULT 'ativo',
  valor       numeric(14, 2),
  criado_em   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (empresa_id, nome)
);

CREATE TABLE categorias (
  id    bigserial PRIMARY KEY,
  nome  text NOT NULL UNIQUE,
  cor   text
);

INSERT INTO categorias (nome) VALUES
  ('Financeiro'), ('Comercial'), ('Jurídico'), ('Suporte'), ('Pessoal'), ('Spam');

CREATE TABLE contatos (
  id                  bigserial PRIMARY KEY,
  jid                 text NOT NULL UNIQUE,
  nome                text,
  empresa_padrao_id   bigint REFERENCES empresas(id),
  criado_em           timestamptz NOT NULL DEFAULT now(),
  atualizado_em       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE conversas (
  id          bigserial PRIMARY KEY,
  jid         text NOT NULL UNIQUE,
  tipo        text NOT NULL CHECK (tipo IN ('individual', 'grupo')),
  contato_id  bigint REFERENCES contatos(id),
  nome        text,
  -- ignorar: não grava nada; arquivar: grava mas não classifica
  modo        text NOT NULL DEFAULT 'classificar' CHECK (modo IN ('classificar', 'arquivar', 'ignorar')),
  criado_em   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE eventos_webhook (
  id             bigserial PRIMARY KEY,
  instancia      text NOT NULL,
  evento         text NOT NULL,
  payload        jsonb NOT NULL,
  recebido_em    timestamptz NOT NULL DEFAULT now(),
  processado_em  timestamptz,
  erro           text
);
CREATE INDEX eventos_webhook_pendentes ON eventos_webhook (recebido_em) WHERE processado_em IS NULL;

CREATE TABLE mensagens (
  id               bigserial PRIMARY KEY,
  whatsapp_msg_id  text NOT NULL,
  conversa_id      bigint NOT NULL REFERENCES conversas(id),
  remetente_id     bigint REFERENCES contatos(id),
  de_mim           boolean NOT NULL,
  tipo             text NOT NULL,
  texto            text,
  midia_url        text,
  recebida_em      timestamptz NOT NULL,
  evento_id        bigint REFERENCES eventos_webhook(id),
  criado_em        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (conversa_id, whatsapp_msg_id)
);
CREATE INDEX mensagens_conversa_data ON mensagens (conversa_id, recebida_em DESC);

CREATE TABLE classificacoes (
  id                  bigserial PRIMARY KEY,
  mensagem_id         bigint NOT NULL REFERENCES mensagens(id),
  empresa_id          bigint REFERENCES empresas(id),
  negocio_id          bigint REFERENCES negocios(id),
  segmento_id         bigint REFERENCES segmentos(id),
  categoria_id        bigint REFERENCES categorias(id),
  prioridade          text CHECK (prioridade IN ('baixa', 'media', 'alta', 'urgente')),
  resumo              text,
  acao_sugerida       text,
  confianca           real,
  modelo              text,
  corrigido_por_voce  boolean NOT NULL DEFAULT false,
  criado_em           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX classificacoes_mensagem ON classificacoes (mensagem_id);

CREATE TABLE sugestoes (
  id               bigserial PRIMARY KEY,
  tipo             text NOT NULL CHECK (tipo IN ('empresa', 'negocio', 'segmento')),
  nome_sugerido    text NOT NULL,
  mensagem_ids     bigint[] NOT NULL DEFAULT '{}',
  status           text NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente', 'aprovada', 'recusada')),
  criado_em        timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE estado_conexao (
  instancia      text PRIMARY KEY,
  estado         text NOT NULL,
  atualizado_em  timestamptz NOT NULL DEFAULT now()
);
