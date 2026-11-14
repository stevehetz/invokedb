// Entry point for the TypeORM CLI (npm run migration:run / migration:revert)
import 'tsconfig-paths/register';
import { DataSource } from 'typeorm';
import config from './_ormconfig';

export default new DataSource(config);
