import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import config from './_ormconfig';

@Module({
    imports: [
        TypeOrmModule.forRoot({
            ...config,
            retryAttempts: 100,
            retryDelay: 10000
        })
    ]
})
export class DatabaseModule {}
