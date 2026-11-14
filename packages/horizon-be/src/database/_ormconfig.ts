import { ConnectionOptions } from 'typeorm';
import env from '@app/env';

const config: ConnectionOptions = {
    type: 'postgres',
    host: env.HORIZON_POSTGRES_HOST,
    port: parseInt(env.HORIZON_POSTGRES_PORT, 10),
    username: env.HORIZON_POSTGRES_USERNAME,
    password: env.HORIZON_POSTGRES_PASSWORD,
    database: env.HORIZON_POSTGRES_DB,
    entities: [__dirname + 'core/../**/*.entity{.ts,.js}'],
    migrationsTableName: 'migration',
    migrations: ['src/database/migration/*.ts'],
    migrationsRun: false,
    synchronize: false,
    cli: {
        migrationsDir: 'src/database/migration'
    }
};

export default config;
