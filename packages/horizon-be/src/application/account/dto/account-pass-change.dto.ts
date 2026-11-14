import { IsNotEmpty } from 'class-validator';

export class AccountPassChangeDto {
    @IsNotEmpty()
    current_password: string;

    @IsNotEmpty()
    new_password: string;
}
