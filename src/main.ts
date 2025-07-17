import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ConfigService } from './config/config.service';
import { ValidationPipe } from '@nestjs/common';

async function bootstrap() {
  const startTime = Date.now();

  const app = await NestFactory.create(AppModule.forRoot());

  const configService = app.get(ConfigService);

  app.useGlobalPipes(new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
  }));

  const port = configService.getAppPort();
  const appMode = configService.getAppMode();

  await app.listen(port, '0.0.0.0');

  const startupTime = Date.now() - startTime;

  if (appMode === 'PRODUCER') {
    console.log(`🔄 Producer mode: Handling HTTP requests and queuing jobs (startup: ${startupTime}ms)`);
  } else {
    console.log(`⚡ Consumer mode: Processing jobs from queue (startup: ${startupTime}ms)`);
  }
}

bootstrap();
