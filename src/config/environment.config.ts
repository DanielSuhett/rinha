import { z } from 'zod';

const environmentSchema = z.object({
	APP_PORT: z.coerce.number().default(3000),
	APP_MODE: z.enum(['PRODUCER', 'CONSUMER']).default('PRODUCER'),
	REDIS_HOST: z.string().default('localhost'),
	REDIS_PORT: z.coerce.number().default(6380),
	PROCESSOR_DEFAULT_URL: z.string(),
	PROCESSOR_FALLBACK_URL: z.string(),
});

export type Environment = z.infer<typeof environmentSchema>;

export function validateEnvironment(): Environment {
	const result = environmentSchema.safeParse(process.env);

	if (!result.success) {
		throw new Error(`Environment validation failed: ${result.error.message}`);
	}

	return result.data;
}