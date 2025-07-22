import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ConfigService } from './config/config.service';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    logger: false,
    abortOnError: false,
    bufferLogs: false,
  });

  app.enableCors();

  const configService = app.get(ConfigService);
  const port = configService.getAppPort();

  await app.listen(port, '0.0.0.0', () => {
    console.log(`Server running on port ${port}`);
  });
}
bootstrap();
