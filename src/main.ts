import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ConfigService } from './config/config.service';
import { ValidationPipe } from '@nestjs/common';

async function bootstrap() {
  const app = await NestFactory.create(AppModule.forRoot());
  const configService = app.get(ConfigService);
  
  app.useGlobalPipes(new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
  }));
  
  const port = configService.getAppPort();
  const appMode = configService.getAppMode();

  await app.listen(port);
  if (appMode === 'PRODUCER') {
    console.log('🔄 Producer mode: Handling HTTP requests and queuing jobs');
  } else {
    console.log('⚡ Consumer mode: Processing jobs from queue');
  }
}
bootstrap();
