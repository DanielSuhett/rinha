import { Module, DynamicModule, Global } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { RedisModule } from '@nestjs-modules/ioredis';
import { ConfigModule } from '../config/config.module';
import { ConfigService } from '../config/config.service';

@Global()
@Module({})
export class SharedModule {
  static forRoot(): DynamicModule {
    return {
      module: SharedModule,
      imports: [
        HttpModule.registerAsync({
          imports: [ConfigModule],
          inject: [ConfigService],
          useFactory: () => ({
            timeout: 10000,
          }),
        }),
        RedisModule.forRootAsync({
          imports: [ConfigModule],
          useFactory: (configService: ConfigService) => {
            const redisConfig = configService.getRedisConfig();
            return {
              type: 'single',
              url: `redis://${redisConfig.host}:${redisConfig.port}`,
              keyPrefix: process.env.APP_MODE === 'PRODUCER' ? 'prod:' : 'cons:',
            };
          },
          inject: [ConfigService],
        }),
      ],
      exports: [HttpModule, RedisModule],
    };
  }
}