import { Contains, IsOptional, IsInt, Length, Validate } from 'class-validator';
import { FileDirNameValidator } from './file-directory-name-validator';

export class FileDirectoryCreateDto {
    @IsInt()
    account_id: number;

    @Length(1, 100)
    @Validate(FileDirNameValidator)
    name: string;

    @Contains('')
    type: string;

    @IsOptional()
    @Contains('')
    web_file_type?: string;

    @IsOptional()
    @IsInt()
    parent_id?: number;
}
