import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ConfigService } from './config/config.service';
import { ValidationPipe } from '@nestjs/common';

async function bootstrap() {
  const app = await NestFactory.create(AppModule.forRoot());

  const configService = app.get(ConfigService);

  const port = configService.getAppPort();

  await app.listen(port, '0.0.0.0');
}
bootstrap();
