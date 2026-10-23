-- Cadastro inicial definido com o Thiago em 2026-10-23.
-- "Pessoal" entra como empresa para que toda mensagem tenha uma empresa e o filtro
-- "empresas x pessoal" seja um simples WHERE empresa.

ALTER TABLE empresas ADD COLUMN descricao text;
ALTER TABLE negocios ADD COLUMN descricao text;
ALTER TABLE categorias ADD COLUMN descricao text;

INSERT INTO segmentos (nome, descricao) VALUES
  ('Comércio exterior', 'Agenciamento de carga internacional, despacho aduaneiro, importação e exportação'),
  ('Logística', 'Transporte, DTA, armazenagem geral e alfandegada'),
  ('Produtos elétricos', 'Marcas próprias de produtos elétricos vendidas no Brasil'),
  ('Pessoal', 'Assuntos pessoais e familiares do Thiago');

INSERT INTO empresas (segmento_id, nome, apelidos, descricao, palavras_chave) VALUES
  ((SELECT id FROM segmentos WHERE nome = 'Comércio exterior'), 'Kas Agenciamentos',
   '{Kas,"Kas Group","Grupo Kas"}',
   'Agenciamento de carga e despacho aduaneiro. Empresa principal, dona das demais.',
   '{frete,"agente de carga",booking,BL,AWB,"despacho aduaneiro",DI,DUIMP,"canal",desembaraço,NCM,LI,armador,consolidação,"frete internacional"}'),
  ((SELECT id FROM segmentos WHERE nome = 'Comércio exterior'), 'Kamex Trading',
   '{Kamex,Camex}',
   'Trading de importação e exportação, com ênfase em importação e viabilidade de custo. Unidades ES e SC. Tem marcas de produtos elétricos.',
   '{trading,importação,exportação,"conta e ordem",encomenda,fornecedor,China,proforma,"estudo de viabilidade",custo,"Espírito Santo","Santa Catarina",FUNDAP,"produtos elétricos"}'),
  ((SELECT id FROM segmentos WHERE nome = 'Logística'), 'WTA Logistics',
   '{WTA}',
   'Logística integrada: transporte geral, DTA, armazém geral e operador logístico em armazém alfandegado.',
   '{transporte,caminhão,coleta,entrega,DTA,armazém,armazenagem,"armazém alfandegado",EADI,"porto seco",container,devolução,"operador logístico"}'),
  ((SELECT id FROM segmentos WHERE nome = 'Pessoal'), 'Pessoal',
   '{}',
   'Família, amigos, compras e assuntos pessoais do Thiago.',
   '{}');

INSERT INTO negocios (empresa_id, nome, descricao) VALUES
  ((SELECT id FROM empresas WHERE nome = 'Kas Agenciamentos'), 'Agenciamento de carga', 'Frete internacional marítimo e aéreo, booking, consolidação'),
  ((SELECT id FROM empresas WHERE nome = 'Kas Agenciamentos'), 'Despacho aduaneiro', 'Desembaraço de importação e exportação, DI/DUIMP, canal, exigências'),
  ((SELECT id FROM empresas WHERE nome = 'Kamex Trading'), 'Importação', 'Importação por conta e ordem ou encomenda, estudo de viabilidade e custo'),
  ((SELECT id FROM empresas WHERE nome = 'Kamex Trading'), 'Exportação', 'Operações de exportação'),
  ((SELECT id FROM empresas WHERE nome = 'Kamex Trading'), 'Produtos elétricos', 'Venda das marcas próprias de produtos elétricos'),
  ((SELECT id FROM empresas WHERE nome = 'WTA Logistics'), 'Transporte geral', 'Coletas, entregas e transporte rodoviário'),
  ((SELECT id FROM empresas WHERE nome = 'WTA Logistics'), 'DTA', 'Declaração de Trânsito Aduaneiro, remoção entre recintos'),
  ((SELECT id FROM empresas WHERE nome = 'WTA Logistics'), 'Armazém geral', 'Armazenagem geral'),
  ((SELECT id FROM empresas WHERE nome = 'WTA Logistics'), 'Armazém alfandegado', 'Operador logístico em recinto alfandegado');

-- Troca as categorias genéricas da 001 pelas do dia a dia de comex e logística.
DELETE FROM categorias WHERE id NOT IN (SELECT categoria_id FROM classificacoes WHERE categoria_id IS NOT NULL);

INSERT INTO categorias (nome, descricao) VALUES
  ('Cotação e comercial', 'Pedido de cotação, proposta, negociação, novo cliente'),
  ('Operação e embarque', 'Acompanhamento de carga, booking, chegada, coleta, entrega, status'),
  ('Documentação e aduana', 'Documentos, DI/DUIMP, LI, exigências, canal, desembaraço'),
  ('Financeiro', 'Pagamentos, cobranças, notas fiscais, câmbio, impostos'),
  ('Fornecedores e parceiros', 'Armadores, transportadoras, agentes, fornecedores no exterior'),
  ('Equipe e interno', 'Conversas com a equipe e assuntos internos das empresas'),
  ('Jurídico e contratos', 'Contratos, procurações, questões legais'),
  ('Agenda e reuniões', 'Marcar, confirmar ou remarcar compromissos'),
  ('Pessoal', 'Família, amigos e assuntos pessoais'),
  ('Propaganda e spam', 'Promoções, correntes e mensagens sem ação')
ON CONFLICT (nome) DO UPDATE SET descricao = EXCLUDED.descricao;
