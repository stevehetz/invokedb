import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, LessThan, Repository } from 'typeorm';
import { Account } from '@app/core/account/account.entity';
import { ApiKey } from '@app/core/api-key/api-key.entity';
import { FileDirectory } from '@app/core/file-directory/file-directory.entity';
import { generate_api_key } from '@app/core/account/api-key';
import { OnboardingManager } from '@app/core/onboarding/onboarding.manager';
import { assert_verified } from '@app/core/email-verification/email-verification';
import { api_key_change } from '@app/core/audit/audit';
import { AuditService } from '../audit/audit.service';
import {
    MAX_API_KEYS,
    REVOKED_KEPT_DAYS,
    hash_api_key,
    key_prefix,
    key_rate_limit,
    parse_new_key,
    revoked_cutoff,
    should_touch_last_used
} from '@app/core/api-key/api-key-rules';
import { KeyRequestLogManager } from '@app/core/api-key/key-request-log.manager';
import { MAX_LOGGED_REQUESTS } from '@app/core/api-key/key-request-log';

// An account's API keys (#138): made, listed and revoked from the app (/api-key, session only),
// and looked up by the bearer strategy for /api/v1.
@Injectable()
export class ApiKeyService {
    constructor(
        @InjectRepository(ApiKey)
        private readonly api_key_repository: Repository<ApiKey>,
        @InjectRepository(Account)
        private readonly account_repository: Repository<Account>,
        @InjectRepository(FileDirectory)
        private readonly file_directory_repository: Repository<FileDirectory>,
        private readonly onboarding_manager: OnboardingManager,
        private readonly audit_svc: AuditService,
        private readonly request_log: KeyRequestLogManager
    ) {}

    // The audit log (#217): keys are account-wide changes, on no table
    private async audit(account_id: number, action: 'api_key.created' | 'api_key.revoked', key) {
        const account = await this.account_repository.findOneBy({ id: account_id });
        await this.audit_svc.record(account, null, [{ action, ...api_key_change(action, key) }]);
    }

    /**
     * The account a live key belongs to, with the key's scope on it (`key_scope`), or null for
     * an unknown or revoked key, or a deleted account.
     */
    async account_from_key(key: string): Promise<Account | null> {
        if (!key || typeof key !== 'string') return null;
        const api_key = await this.api_key_repository.findOneBy({
            key_hash: hash_api_key(key),
            revoked_datetime: IsNull()
        });
        if (!api_key) return null;
        const account = await this.account_repository.findOneBy({
            id: api_key.account_id,
            deleted: false
        });
        if (!account) return null;

        const now = new Date();
        if (should_touch_last_used(api_key.last_used_datetime, now)) {
            this.api_key_repository
                .update({ id: api_key.id }, { last_used_datetime: now })
                .catch(err => console.error('api-key: could not record last use', err));
        }

        account.key_scope = {
            key_id: api_key.id,
            access: api_key.access,
            table_ids: api_key.table_ids,
            name: api_key.name,
            prefix: api_key.prefix,
            rate_limit: key_rate_limit(api_key.rate_limit_per_second, api_key.rate_limit_burst)
        };
        return account;
    }

    /**
     * `{ requests, max }`: one of the account's keys' last requests (#216), newest first, each
     * `{ at, method, path, status, duration_ms }`. 404 for a key of another account.
     */
    async requests(account_id: number, id: unknown) {
        const key = await this.owned(account_id, id);
        return {
            requests: await this.request_log.list(account_id, key.id),
            max: MAX_LOGGED_REQUESTS
        };
    }

    /**
     * `{ keys, max, revoked_kept_days, tables }`: the account's keys, live ones first, newest
     * first, and the account's tables (`{ id, name }`) a new key can be limited to. Keys revoked
     * more than REVOKED_KEPT_DAYS ago are deleted first (#178).
     */
    async list(account_id: number) {
        const expired = await this.api_key_repository.findBy({
            account_id,
            revoked_datetime: LessThan(revoked_cutoff(new Date()))
        });
        if (expired.length > 0) {
            const ids = expired.map(k => k.id);
            await this.api_key_repository.delete({ account_id, id: In(ids) });
            // Their request logs go with them (#216)
            await this.request_log.remove(account_id, ids).catch(err => {
                console.error('api-key: could not delete request logs', err);
            });
        }
        const keys = await this.api_key_repository.find({
            where: { account_id },
            order: { id: 'DESC' }
        });
        const tables = await this.tables_by_id(account_id);
        const views = keys.map(k => this.view(k, tables));
        views.sort((a, b) => Number(!!a.revoked_datetime) - Number(!!b.revoked_datetime));
        return {
            keys: views,
            max: MAX_API_KEYS,
            revoked_kept_days: REVOKED_KEPT_DAYS,
            tables: [...tables].map(([id, name]) => ({ id, name }))
        };
    }

    /** `{ key, secret }`: `secret` is the key itself, shown this once and never stored. */
    async create(account_id: number, body: unknown) {
        // Keys need a verified email, like tables (#132)
        assert_verified(await this.account_repository.findOneBy({ id: account_id }));
        const input = parse_new_key(body);
        const live = await this.api_key_repository.countBy({
            account_id,
            revoked_datetime: IsNull()
        });
        if (live >= MAX_API_KEYS) {
            throw new BadRequestException(
                `An account can have ${MAX_API_KEYS} keys. Revoke one to make another.`
            );
        }

        const tables = await this.tables_by_id(account_id);
        if (input.table_ids && !input.table_ids.every(id => tables.has(id))) {
            throw new BadRequestException('table_ids: not a table of this account');
        }

        // 62^32 keys: a clash is next to impossible, but key_hash is unique, so try again
        for (let tries = 0; tries < 5; tries++) {
            const secret = generate_api_key();
            const key_hash = hash_api_key(secret);
            if (await this.api_key_repository.existsBy({ key_hash })) continue;
            const saved = await this.api_key_repository.save(
                this.api_key_repository.create({
                    account_id,
                    name: input.name,
                    access: input.access,
                    table_ids: input.table_ids,
                    rate_limit_per_second: input.rate_limit?.per_second ?? null,
                    rate_limit_burst: input.rate_limit?.burst ?? null,
                    prefix: key_prefix(secret),
                    key_hash
                })
            );
            // The onboarding checklist's "get an API key" step (#143)
            await this.onboarding_manager.mark(account_id, 'view_api_key').catch(err => {
                console.error('onboarding: could not mark the key step', err);
            });
            await this.audit(account_id, 'api_key.created', saved);
            return { key: this.view(saved, tables), secret };
        }
        throw new Error('Could not make a unique API key');
    }

    /** Revokes one of the account's keys for good; it stops working at once. */
    async revoke(account_id: number, id: unknown) {
        const key = await this.owned(account_id, id);
        if (!key.revoked_datetime) {
            key.revoked_datetime = new Date();
            await this.api_key_repository.update(
                { id: key.id, account_id },
                { revoked_datetime: key.revoked_datetime }
            );
            await this.audit(account_id, 'api_key.revoked', key);
        }
        return this.view(key, await this.tables_by_id(account_id));
    }

    private async owned(account_id: number, id: unknown): Promise<ApiKey> {
        const key_id = Number(id);
        if (!account_id || !Number.isInteger(key_id) || key_id <= 0) {
            throw new NotFoundException();
        }
        const key = await this.api_key_repository.findOneBy({ id: key_id, account_id });
        if (!key) throw new NotFoundException();
        return key;
    }

    // The account's tables (not folders), by id
    private async tables_by_id(account_id: number): Promise<Map<number, string>> {
        const rows = await this.file_directory_repository.findBy({
            account_id,
            type: 'file',
            deleted: false
        });
        return new Map(rows.map(r => [r.id, r.name]));
    }

    // Never the hash. Tables deleted since are left out of `tables`.
    private view(key: ApiKey, tables: Map<number, string>) {
        return {
            id: key.id,
            name: key.name,
            prefix: key.prefix,
            access: key.access,
            table_ids: key.table_ids,
            tables: key.table_ids
                ? key.table_ids
                      .filter(id => tables.has(id))
                      .map(id => ({ id, name: tables.get(id) }))
                : null,
            // null: no limit of the key's own (#216)
            rate_limit: key_rate_limit(key.rate_limit_per_second, key.rate_limit_burst),
            created_datetime: key.created_datetime,
            last_used_datetime: key.last_used_datetime,
            revoked_datetime: key.revoked_datetime
        };
    }
}
