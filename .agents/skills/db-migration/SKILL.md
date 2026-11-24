---
name: db-migration
description: Create, write, run and revert TypeORM 0.3 migrations for horizon-be's Postgres schema, including entity changes. Use when adding or changing an entity or column, writing seed data, or when the user mentions migrations or schema changes.
---

# TypeORM migrations (horizon-be, Postgres)

- Config: `packages/horizon-be/src/database/_ormconfig.ts` (shared by the app and the CLI).
  CLI entry point: `src/database/data-source.ts`.
- `synchronize: false` and `migrationsRun: false`: the schema only changes through migrations,
  and `npm run dev` does **not** run them. `db:setup` / `migration:run` do.
- Migration history is in the Postgres table `migration`.
- Mongo has no schema and no migrations. Grid data shape changes are handled in code.

## Workflow

1. **Change the entity** (`src/core/**/<name>.entity.ts`). Use explicit column types for
   anything that isn't a plain int or string: `@Column({ type: 'decimal' })` for money
   (otherwise 0.3 `parseInt`s it), `varchar` lengths, `nullable: true` where null is valid.
2. **Create the migration** from the repo root:

   ```sh
   npm run migration:create -- AddFooToAccount
   # → packages/horizon-be/src/database/migration/<timestamp>-AddFooToAccount.ts
   ```

   You can also generate a draft from the entity diff, then review it by hand, because it can
   pick up unrelated drift:

   ```sh
   bash scripts/be-run.sh typeorm migration:generate src/database/migration/AddFooToAccount
   ```

3. **Write `up` and `down`.** Both must work. `down` undoes exactly what `up` did.

   ```ts
   import { MigrationInterface, QueryRunner } from 'typeorm';

   export class AddFooToAccount1700000000000 implements MigrationInterface {
     public async up(queryRunner: QueryRunner): Promise<void> {
       await queryRunner.query(`ALTER TABLE account ADD COLUMN foo VARCHAR(100)`);
     }

     public async down(queryRunner: QueryRunner): Promise<void> {
       await queryRunner.query(`ALTER TABLE account DROP COLUMN foo`);
     }
   }
   ```

   - **Always `await` `queryRunner.query`.** Some old migrations don't (for example
     `SubIdColumnType`). Don't copy that.
   - Never edit a migration that has already run anywhere. Add a new one.
   - Never put secrets in a migration. The repo is public. Read them from `process.env`, the
     way `Initial` reads `STRIPE_*`.

4. **Run, revert, run** to prove both directions work:

   ```sh
   npm run migration:run
   npm run migration:revert    # reverts only the latest; ask the user before running it on their DB
   npm run migration:run
   npm --prefix packages/horizon-be run build
   ```

   Better still, run it on throwaway DBs (`HORIZON_ENV_FILE`, see `verify-backend`), including
   a run of all migrations from scratch.

5. **Check the app still works**: `verify-backend` (the smoke diff), plus any queries that touch
   the changed table. Remember that `invalidWhereValuesBehavior` throws on `null`/`undefined`
   in where clauses, so a new nullable column used in `findOneBy` needs an explicit
   `IsNull()` or an early return.

## Demo data

There is no database dump. `npm run db:demo` resets the databases, runs every migration (they
seed the demo accounts), then loads the example tables through the API with
`examples/setup.mjs`, so a new migration needs no demo-data change.
