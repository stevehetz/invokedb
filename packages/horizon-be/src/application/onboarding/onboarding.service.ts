import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { FileDirectory } from '@app/core/file-directory/file-directory.entity';
import { OnboardingManager } from '@app/core/onboarding/onboarding.manager';
import { build_onboarding, MarkableStep, OnboardingView } from '@app/core/onboarding/onboarding';

@Injectable()
export class OnboardingService {
    constructor(
        @InjectRepository(FileDirectory)
        private readonly file_directory_repository: Repository<FileDirectory>,
        private readonly onboarding_manager: OnboardingManager
    ) {}

    async get(account_id: number, base_url: string): Promise<OnboardingView> {
        const [state, table] = await Promise.all([
            this.onboarding_manager.get_state(account_id),
            // The newest table: most likely the one just made for this
            this.file_directory_repository.findOne({
                where: { account_id, type: 'file', deleted: false },
                order: { id: 'DESC' }
            })
        ]);
        return build_onboarding({
            state,
            table: table ? table.name : null,
            base_url
        });
    }

    async mark(account_id: number, step: MarkableStep, base_url: string) {
        await this.onboarding_manager.mark(account_id, step);
        return await this.get(account_id, base_url);
    }

    async dismiss(account_id: number, base_url: string) {
        await this.onboarding_manager.dismiss(account_id);
        return await this.get(account_id, base_url);
    }
}
