import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppModule } from './app.module';
import { ConfigService } from './config/config.service';
import { InMemoryQueueService } from './common/in-memory-queue/in-memory-queue.service';
import { PaymentService } from './payment/payment.service';
import { PaymentDto } from './payment/payment.dto';

async function bootstrap() {
  const fastifyAdapter = new FastifyAdapter({
    logger: false,
    disableRequestLogging: true,
    ignoreTrailingSlash: true,
    maxParamLength: 100,
    bodyLimit: 1024 * 16,
    keepAliveTimeout: 72000,
    connectionTimeout: 0,
    requestIdHeader: false,
  });

  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    fastifyAdapter,
    {
      abortOnError: false,
      bufferLogs: false,
    }
  );

  const configService = app.get(ConfigService);
  const queueService = app.get(InMemoryQueueService);
  const paymentService = app.get(PaymentService);

  const fastifyInstance = app.getHttpAdapter().getInstance();

  fastifyInstance.post('/payments', (request, reply) => {
    queueService.add(request.body as string);
    reply.raw.statusCode = 201;
    reply.raw.end();
  });

  fastifyInstance.get('/payments-summary', async (request, reply) => {
    const query = request.query as { from?: string; to?: string };
    const result = await paymentService.getPaymentSummary(query.from, query.to);
    reply.send(result);
  });

  fastifyInstance.get('/health', (request, reply) => {
    reply.raw.statusCode = 200;
    reply.raw.end('OK');
  });

  const port = configService.getAppPort();

  await app.listen(port, '0.0.0.0', () => {
    console.log(`Server running on port ${port}`);
  });
}
bootstrap();
