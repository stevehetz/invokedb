import { IsInt, IsOptional } from 'class-validator';

export class PageParamsDto {
    @IsInt()
    @IsOptional()
    skip: number;

    @IsInt()
    @IsOptional()
    take: number;

    @IsOptional()
    order: any;

    @IsOptional()
    where: any;
}
