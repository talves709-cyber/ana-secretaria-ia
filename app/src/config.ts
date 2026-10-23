import { z } from 'zod';

const esquema = z.object({
  PORT: z.coerce.number().default(3100),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
  EVOLUTION_URL: z.string().url(),
  EVOLUTION_API_KEY: z.string().min(1),
  EVOLUTION_INSTANCE: z.string().default('ana'),
  WEBHOOK_URL: z.string().url(),
  WEBHOOK_TOKEN: z.string().min(16, 'WEBHOOK_TOKEN precisa de pelo menos 16 caracteres'),
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
