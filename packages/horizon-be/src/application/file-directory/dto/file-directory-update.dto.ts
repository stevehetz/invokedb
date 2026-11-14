import { Contains, IsOptional, IsInt, Length, Validate } from 'class-validator';
import { FileDirNameValidator } from './file-directory-name-validatior';

export class FileDirectoryUpdateDto {
    @IsInt()
    id: number;

    @IsInt()
    account_id: number;

    @Length(1, 100)
    @Validate(FileDirNameValidator)
    name: string;

    @IsOptional()
    @IsInt()
    parent_id?: number;
}
