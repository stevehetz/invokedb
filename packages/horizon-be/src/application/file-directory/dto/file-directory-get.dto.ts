export class FileDirectoryGetDto {
    id: number;
    account_id: number;
    name: string;
    type: string;
    web_file_type: string;
    parent_id: number;
    deleted: boolean;
    locked: boolean;
    locked_reason: string;
}
