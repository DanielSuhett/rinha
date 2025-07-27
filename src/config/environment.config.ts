import { z } from 'zod';

const environmentSchema = z.object({
  APP_PORT: z.coerce.number().default(3000),
  APP_NAME: z.enum(['1', '2']).default('1'),

  REDIS_HOST: z.string().default('localhost'),
  REDIS_PORT: z.coerce.number().default(6380),

  PROCESSOR_DEFAULT_URL: z.string(),
  PROCESSOR_FALLBACK_URL: z.string(),

  // frequency pool to dequeue from redis queue
  POOLING_INTERVAL: z.number().default(1000),

  // circuit breaker fine tuning params
  HEALTH_TIMEOUT: z.number().default(1000),
  HEALTH_INTERVAL: z.number().default(5000),
  LATENCY_DIFF_TO_USE_FALLBACK: z.number().default(5000),
});


export type Environment = z.infer<typeof environmentSchema>;

export function validateEnvironment(): Environment {
  const result = environmentSchema.safeParse(process.env);

  if (!result.success) {
    throw new Error(`Environment validation failed: ${result.error.message}`);
  }

  return result.data;
}
