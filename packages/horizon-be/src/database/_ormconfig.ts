import { DataSourceOptions } from 'typeorm';
import env from '@app/env';

// Shared by the Nest app (database.module.ts) and the TypeORM CLI (data-source.ts)
const config: DataSourceOptions = {
    type: 'postgres',
    host: env.HORIZON_POSTGRES_HOST,
    port: parseInt(env.HORIZON_POSTGRES_PORT, 10),
    username: env.HORIZON_POSTGRES_USERNAME,
    password: env.HORIZON_POSTGRES_PASSWORD,
    database: env.HORIZON_POSTGRES_DB,
    entities: [__dirname + '/../**/*.entity{.ts,.js}'],
    migrationsTableName: 'migration',
    migrations: [__dirname + '/migration/*{.ts,.js}'],
    migrationsRun: false,
    synchronize: false,
    // TypeORM 0.3 silently drops `undefined` (and `null`) from find conditions, so
    // findOneBy({ token: undefined }) would return the first row. Fail loudly instead.
    invalidWhereValuesBehavior: { null: 'throw', undefined: 'throw' }
};

export default config;
