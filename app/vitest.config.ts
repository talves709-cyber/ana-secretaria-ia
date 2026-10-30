import { defineConfig } from 'vitest/config';

// Um único Postgres embutido por execução (globalSetup), com o banco modelo já migrado; cada arquivo
// de teste cria o seu banco a partir do modelo (CREATE DATABASE ... TEMPLATE, rápido) e isola os
// testes com limparBanco. Como há um só servidor, o número de workers não multiplica Postgres;
// mantém-se o padrão do vitest.
export default defineConfig({
  test: {
    globalSetup: ['./test/apoio/global.ts'],
    testTimeout: 30_000,
    hookTimeout: 120_000,
  },
});
