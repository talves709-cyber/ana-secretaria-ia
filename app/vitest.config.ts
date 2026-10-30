import { defineConfig } from 'vitest/config';

// Cada arquivo de teste que usa banco sobe o seu próprio Postgres embutido (beforeAll) e isola
// os testes com limparBanco (beforeEach). Limita os workers a 2 para haver no máximo 2 Postgres
// ao mesmo tempo nesta máquina.
export default defineConfig({
  test: {
    maxWorkers: 2,
    testTimeout: 30_000,
    hookTimeout: 120_000,
  },
});
