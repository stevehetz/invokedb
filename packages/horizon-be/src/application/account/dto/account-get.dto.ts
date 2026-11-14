import { Expose } from 'class-transformer';

export class AccountGetDto {
    @Expose() id: number;
    @Expose() first_name: string;
    @Expose() last_name: string;
    @Expose() email: string;
    @Expose() deleted: boolean;
}
