// Runs pending migrations from the compiled build: `node dist/database/migrate.js`. The TypeORM
// CLI entry (data-source.ts) needs ts-node and tsconfig-paths, so it's for local dev only.
if (!process.env.IS_TS_NODE) {
    require('module-alias/register');
}

import { DataSource } from 'typeorm';
import config from './_ormconfig';

async function run() {
    const data_source = await new DataSource(config).initialize();
    try {
        const ran = await data_source.runMigrations();
        console.log(
            ran.length ? `Ran ${ran.map(m => m.name).join(', ')}` : 'No pending migrations'
        );
    } finally {
        await data_source.destroy();
    }
}

run().catch(err => {
    console.error(err);
    process.exit(1);
});
