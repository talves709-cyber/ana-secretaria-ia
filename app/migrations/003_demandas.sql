-- Partes 0 e 1: clientes, demandas, rascunhos, aprovações e envios.

CREATE TABLE clientes (
  id           bigserial PRIMARY KEY,
  nome         text NOT NULL,
  observacoes  text,
  criado_em    timestamptz NOT NULL DEFAULT now()
);

-- valor é o JID da conversa (individual ou grupo) ou o endereço de e-mail.
CREATE TABLE cliente_contatos (
  id          bigserial PRIMARY KEY,
  cliente_id  bigint NOT NULL REFERENCES clientes(id),
  tipo        text NOT NULL CHECK (tipo IN ('whatsapp', 'email')),
  valor       text NOT NULL,
  UNIQUE (tipo, valor)
);

CREATE TABLE demandas (
  id              bigserial PRIMARY KEY,
  cliente_id      bigint NOT NULL REFERENCES clientes(id),
  conversa_id     bigint REFERENCES conversas(id),
  empresa_id      bigint REFERENCES empresas(id),
  categoria_id    bigint REFERENCES categorias(id),
  titulo          text NOT NULL,
  plano           text,
  prazo           timestamptz,
  prazo_tem_hora  boolean NOT NULL DEFAULT false,
  etapa           text NOT NULL DEFAULT 'novo'
                  CHECK (etapa IN ('novo', 'comigo', 'aguardando_terceiro', 'agendado', 'concluido')),
  etapa_sugerida  text CHECK (etapa_sugerida IN ('concluir', 'agendar', 'aguardar', 'comigo')),
  prioridade      text NOT NULL CHECK (prioridade IN ('baixa', 'media', 'alta', 'urgente')),
  avisada_em      timestamptz,
  criado_em       timestamptz NOT NULL DEFAULT now(),
  etapa_desde     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX demandas_etapa_prioridade ON demandas (etapa, prioridade);

-- demanda_id NULL: item analisado pelo especialista e deixado sem demanda.
CREATE TABLE demanda_itens (
  id          bigserial PRIMARY KEY,
  mensagem_id bigint NOT NULL UNIQUE REFERENCES mensagens(id),
  demanda_id  bigint REFERENCES demandas(id),
  criado_em   timestamptz NOT NULL DEFAULT now()
);

-- Tudo o que já existia antes desta migração conta como visto: o especialista não reanalisa o histórico.
INSERT INTO demanda_itens (mensagem_id, demanda_id) SELECT id, NULL FROM mensagens ON CONFLICT DO NOTHING;

CREATE TABLE demanda_etapas (
  id          bigserial PRIMARY KEY,
  demanda_id  bigint NOT NULL REFERENCES demandas(id),
  de          text,
  para        text NOT NULL,
  autor       text NOT NULL CHECK (autor IN ('thiago', 'ana', 'agente')),
  motivo      text,
  criado_em   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE rascunhos (
  id          bigserial PRIMARY KEY,
  demanda_id  bigint NOT NULL REFERENCES demandas(id),
  versao      int NOT NULL,
  texto       text NOT NULL,
  destino     text NOT NULL,
  hash        text NOT NULL,
  criado_em   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (demanda_id, versao)
);

CREATE TABLE aprovacoes (
  id          bigserial PRIMARY KEY,
  rascunho_id bigint NOT NULL REFERENCES rascunhos(id),
  hash        text NOT NULL,
  origem      text NOT NULL CHECK (origem IN ('whatsapp', 'painel')),
  criado_em   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE envios (
  id               bigserial PRIMARY KEY,
  chave            text NOT NULL UNIQUE,
  rascunho_id      bigint NOT NULL REFERENCES rascunhos(id),
  destino          text NOT NULL,
  estado           text NOT NULL CHECK (estado IN ('enviando', 'enviado', 'falhou')),
  erro             text,
  whatsapp_msg_id  text,
  criado_em        timestamptz NOT NULL DEFAULT now(),
  enviado_em       timestamptz
);

CREATE TABLE bases_conhecimento (
  id          bigserial PRIMARY KEY,
  empresa_id  bigint NOT NULL REFERENCES empresas(id),
  versao      int NOT NULL,
  texto       text NOT NULL,
  criado_em   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (empresa_id, versao)
);

INSERT INTO bases_conhecimento (empresa_id, versao, texto)
SELECT id, 1, coalesce(descricao, '') FROM empresas;

CREATE TABLE exemplos_estilo (
  id          bigserial PRIMARY KEY,
  empresa_id  bigint REFERENCES empresas(id),
  antes       text NOT NULL,
  depois      text NOT NULL,
  criado_em   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE confirmacoes (
  id              bigserial PRIMARY KEY,
  comandos        jsonb NOT NULL,
  texto_original  text,
  estado          text NOT NULL DEFAULT 'pendente'
                  CHECK (estado IN ('pendente', 'confirmada', 'cancelada', 'expirada')),
  criado_em       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE uso_ia (
  id             bigserial PRIMARY KEY,
  agente         text NOT NULL,
  modelo         text NOT NULL,
  entrada        int NOT NULL DEFAULT 0,
  saida          int NOT NULL DEFAULT 0,
  cache_leitura  int NOT NULL DEFAULT 0,
  cache_escrita  int NOT NULL DEFAULT 0,
  custo_usd      numeric(10, 6) NOT NULL DEFAULT 0,
  criado_em      timestamptz NOT NULL DEFAULT now()
);

-- Avisos que só podem sair uma vez.
CREATE TABLE avisos (
  chave      text PRIMARY KEY,
  criado_em  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE conversas DROP CONSTRAINT conversas_modo_check;
ALTER TABLE conversas ADD CONSTRAINT conversas_modo_check
  CHECK (modo IN ('classificar', 'arquivar', 'ignorar', 'comando'));

-- Índices nas chaves estrangeiras usadas pelas consultas.
CREATE INDEX demandas_cliente ON demandas (cliente_id);
CREATE INDEX demandas_conversa ON demandas (conversa_id);
CREATE INDEX demanda_itens_demanda ON demanda_itens (demanda_id);
CREATE INDEX demanda_etapas_demanda ON demanda_etapas (demanda_id, criado_em);
CREATE INDEX aprovacoes_rascunho ON aprovacoes (rascunho_id);
CREATE INDEX envios_rascunho ON envios (rascunho_id);
