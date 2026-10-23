# Deploy na VPS Hostinger com Easypanel

A VPS usa o modelo "Ubuntu 24.04 with Easypanel". O deploy é um serviço **Compose** do
Easypanel apontando para este repositório. Leva uns 15 minutos na primeira vez.

## 1. Criar o serviço

1. Abra o Easypanel da VPS (pelo hPanel da Hostinger: VPS > Gerenciar > botão do
   Easypanel, ou `http://IP-DA-VPS:3000`).
2. **Create project** com o nome `ana`.
3. Dentro do projeto: **New Service > Compose**, nome `ana`.
4. Em **Source**, escolha **Git** e preencha:
   - Repository URL: `git@github.com:talves709-cyber/ana-secretaria-ia.git`
   - Branch: `main`
   - Build Path: `/`
   - Docker Compose File: `docker-compose.yml`
5. O repositório é privado: copie a **chave SSH** que o Easypanel mostra nessa tela e
   cadastre no GitHub em *Settings > Deploy keys > Add deploy key* (só leitura).

## 2. Variáveis de ambiente

Na aba **Environment** o Easypanel já traz o conteúdo do `.env.example`. Troque cada valor
que começa com `troque-` (o app recusa subir se esquecer algum) e marque
**Create .env file**.

Para gerar valores fortes, qualquer gerador de senha serve, ou no terminal:
`openssl rand -hex 32`.

| Variável | O que é |
| --- | --- |
| `POSTGRES_PASSWORD` | Senha do banco |
| `EVOLUTION_API_KEY` | Chave da API do Evolution (mín. 16 caracteres) |
| `WEBHOOK_TOKEN` | Token que o Evolution envia ao webhook (mín. 16) |
| `PAINEL_SENHA` | Senha da página de conexão (mín. 12) |

Deixe `EVOLUTION_PUBLIC_URL` e `WEBHOOK_URL` como estão: eles usam a rede interna.

## 3. Deploy

Clique em **Deploy**. Na aba de logs, o app deve mostrar `Migrações aplicadas` e depois
`Instância ana: criada` (o app cria a instância no Evolution sozinho).

## 4. Domínio com HTTPS

Em **Domains > Add domain**: serviço `app`, porta `3100`, HTTPS ligado. Pode usar o
domínio gratuito que o Easypanel sugere ou um subdomínio seu (ex.: `ana.seudominio.com.br`,
com um registro A apontando para o IP da VPS).

Só o `app` recebe domínio. Evolution, Postgres e Redis ficam só na rede interna.

## 5. Conectar o WhatsApp

Abra `https://SEU-DOMINIO/conexao`. O navegador pede usuário e senha: o usuário pode ser
qualquer nome e a senha é a `PAINEL_SENHA`. Escaneie o QR Code em
*WhatsApp > Aparelhos conectados > Conectar aparelho*. A página atualiza sozinha e mostra
"WhatsApp conectado" quando terminar.

## Atualizar depois

A cada merge na `main`, clique em **Deploy** no Easypanel (ou ligue o deploy automático
pelo webhook de deploy do Easypanel no GitHub).
