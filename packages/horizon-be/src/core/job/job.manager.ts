import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In, getManager, LessThan } from 'typeorm';
import { Job } from './job.entity';
import env from '@app/env';
import _c from '@app/constants';

@Injectable()
export class JobManager {
    job_state = 'SLEEPING';

    constructor(
        @InjectRepository(Job)
        private job_repository: Repository<Job>
    ) {}

    async create(data) {
        return await this.job_repository.save(data);
    }

    async update(id, data) {
        return await this.job_repository.update(id, data);
    }

    async get_running_jobs() {
        return await this.job_repository.find({
            status: 'RUNNING'
        });
    }

    async get_latest_pending(events) {
        let job;
        await getManager().transaction('SERIALIZABLE', async entityManager => {
            job = await entityManager.findOne(Job, {
                where: {
                    status: 'PENDING',
                    event: In(events)
                },
                order: {
                    created_datetime: 'ASC'
                }
            });
            if (job) {
                job.status = 'RUNNING';
                job.job_processor_id = env.SERVER_NAME;
                await entityManager.save(job);
            }
        });
        return job;
    }
}
