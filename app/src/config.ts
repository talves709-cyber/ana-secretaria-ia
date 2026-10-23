import { z } from 'zod';

/** Segredo que não pode ficar com o valor de exemplo do .env.example. */
const segredo = (minimo: number) =>
  z
    .string()
    .min(minimo, `precisa de pelo menos ${minimo} caracteres`)
    .refine((v) => !v.startsWith('troque-'), 'ainda está com o valor de exemplo; troque no .env');

const esquema = z.object({
  PORT: z.coerce.number().default(3100),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
  EVOLUTION_URL: z.string().url(),
  EVOLUTION_API_KEY: segredo(16),
  EVOLUTION_INSTANCE: z.string().default('ana'),
  WEBHOOK_URL: z.string().url(),
  WEBHOOK_TOKEN: segredo(16),
  PAINEL_SENHA: segredo(12),
  WORKER_CONCURRENCY: z.coerce.number().int().positive().default(5),
});

export type Config = z.infer<typeof esquema>;

export function lerConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const resultado = esquema.safeParse(env);
  if (!resultado.success) {
    const erros = resultado.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Configuração inválida:\n${erros}`);
  }
  return resultado.data;
}
