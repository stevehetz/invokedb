import { Injectable, HttpException, HttpStatus } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { FileDirectory } from '@app/core/file-directory/file-directory.entity';
import { FileDirectoryGetDto } from './dto/file-directory-get.dto';
import { AccountService } from '../account/account.service';
import { WebFileManager } from '@app/core/web-file/web-file.manager';
import { TrackingManager } from '@app/core/tracking/tracking.manager';
import { plainToClass } from 'class-transformer';
import { WebFilePrcNotifyService } from '../web-file/web-file-prc-notify.service';
import _c from '@app/constants';

@Injectable()
export class FileDirectoryService {
    constructor(
        @InjectRepository(FileDirectory)
        private readonly file_directory_repository: Repository<FileDirectory>,
        private account_service: AccountService,
        private web_file_manager: WebFileManager,
        private tracking_manager: TrackingManager,
        private web_file_prc_notify_svc: WebFilePrcNotifyService
    ) {}

    async get_by_id(file_directory_id: number) {
        return await this.file_directory_repository.findOne(file_directory_id);
    }

    async get_by_account_id(account_id: number) {
        return await this.file_directory_repository.find({ account_id, deleted: false });
    }

    async get_all(account_id) {
        const file_directories = await this.file_directory_repository.find({
            where: { account_id, deleted: false },
            order: {
                type: 'ASC',
                name: 'ASC'
            }
        });

        const file_directory_gets: FileDirectoryGetDto[] = plainToClass(
            FileDirectoryGetDto,
            file_directories
        );

        return file_directory_gets;
    }

    async validate(data) {
        if (!data.account_id)
            throw new HttpException('account_id was not passed in', HttpStatus.NOT_FOUND);

        if (!data.name) throw new HttpException('name was not passed in', HttpStatus.NOT_FOUND);

        if (!data.type) throw new HttpException('type was not passed in', HttpStatus.NOT_FOUND);

        if (data.name.length > 150)
            throw new HttpException(
                'Name can not be longer that 150 characters',
                HttpStatus.NOT_FOUND
            );

        if (await this.same_name_type_and_folder_level(data))
            throw new HttpException('Name in use', HttpStatus.NOT_FOUND);
    }

    async same_name_type_and_folder_level(data) {
        const file_directories = await this.get_all(data.account_id);
        let same = false;
        data.parent_id = data.parent_id || null;
        file_directories.some(file_dir => {
            if (
                data.parent_id === file_dir.parent_id &&
                data.type === file_dir.type &&
                data.name.toLowerCase() === file_dir.name.toLowerCase()
            ) {
                same = true;

                // break out of the loop
                return true;
            }
        });
        return same;
    }

    async create(acct_id, data, no_file) {
        const account = await this.account_service.get(acct_id);
        await this.tracking_manager.add_table(account);
        await this.validate(data);
        data.deleted = false;
        const create_dto = data;
        const res = (await this.file_directory_repository.save(create_dto)) as any;
        if (!no_file) await this.web_file_manager.create_new(acct_id, res.id, data.web_file_type);
        return res;
    }

    async update(file_directory_id, data) {
        const update_dto = data as any;
        await this.file_directory_repository.update(file_directory_id, update_dto);
        return await this.get_by_id(file_directory_id);
    }

    async batch_delete(account, data) {
        return new Promise(async (resolve, reject) => {
            try {
                let updated = 0;
                const file_directories = await this.file_directory_repository.findByIds(data.ids);
                file_directories.forEach(async (file_directory: FileDirectory) => {
                    file_directory.deleted = true;
                    this.web_file_prc_notify_svc.file_delete_request(
                        _c.HORIZON_BE_WS_CLIENT_ID,
                        account.id,
                        file_directory.id
                    );
                    await this.file_directory_repository.update(file_directory.id, file_directory);
                    updated++;
                    if (updated === file_directories.length) {
                        await this.tracking_manager.deleted_table(account);
                        this.web_file_manager.delete_dg(account, file_directory.id);
                        resolve('done');
                    }
                });
            } catch (ex) {
                reject(ex);
            }
        });
    }
}
