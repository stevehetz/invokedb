import { Like } from 'typeorm';
import { plainToClass } from 'class-transformer';

export const paging_helper = async (params, repo, dto?) => {
    if (params.where) {
        Object.keys(params.where).forEach(key => {
            params.where[key] = Like(`%${params.where[key]}%`);
        });
    }

    const res = (await repo.findAndCount(params)) as any;
    if (dto) {
        res[0] = plainToClass(dto, res[0], { strategy: 'excludeAll' });
    }
    return { data: res[0], count: res[1] };
};
