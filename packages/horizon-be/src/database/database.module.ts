// require('mongoose').set('debug', true)
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import config from './_ormconfig';
import env from '@app/env';

@Module({
    imports: [
        TypeOrmModule.forRoot({
            type: 'postgres',
            host: env.HORIZON_POSTGRES_HOST,
            port: parseInt(env.HORIZON_POSTGRES_PORT, 10),
            username: env.HORIZON_POSTGRES_USERNAME,
            password: env.HORIZON_POSTGRES_PASSWORD,
            database: env.HORIZON_POSTGRES_DB,
            entities: [__dirname + 'core/../**/*.entity{.ts,.js}'],
            synchronize: false,
            retryAttempts: 100,
            retryDelay: 10000
        })
    ]
})
export class DatabaseModule {}
