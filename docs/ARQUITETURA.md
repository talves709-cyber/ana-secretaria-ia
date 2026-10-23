# Arquitetura — resumo

Documento completo, com diagramas: https://claude.ai/artifact/P1yKVx3KBpgMnpEPew4JpE

```
WhatsApp (celular, QR Code)
   → Evolution API (sessão 24h)
   → POST /webhook/evolution   (app: grava em eventos_webhook, responde 200)
   → fila BullMQ "eventos"     (Redis, retries com espera crescente)
   → worker                    (grava contatos, conversas, mensagens; fase 2: classifica com Claude)
   → PostgreSQL                (banco "ana")
   → painel web / comandos no WhatsApp (fase 3)
```

## Hierarquia

Segmento → Empresa → Negócio. Categoria é transversal. A classificação fica em
`classificacoes`, separada da mensagem. Empresas novas detectadas pela IA viram linhas
em `sugestoes`, nunca empresas direto.

## Decisões em aberto

Ver a seção "Perguntas para você decidir" do documento completo. Suposição usada até
agora: "empresa" = as empresas do Thiago.
