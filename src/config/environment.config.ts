import { z } from 'zod';

const environmentSchema = z.object({
	APP_PORT: z.coerce.number().default(3000),
	REDIS_HOST: z.string().default('localhost'),
	REDIS_PORT: z.coerce.number().default(6379),
	PROCESSOR_DEFAULT_URL: z.string().url(),
	PROCESSOR_FALLBACK_URL: z.string().url(),
	INSTANCE_ID: z.string().optional(),
	WORKER_CONCURRENCY: z.coerce.number().default(1),
});

export type Environment = z.infer<typeof environmentSchema>;

export function validateEnvironment(): Environment {
	const result = environmentSchema.safeParse(process.env);
	
	if (!result.success) {
		throw new Error(`Environment validation failed: ${result.error.message}`);
	}
	
	return result.data;
} 