import { Injectable, HttpException, HttpStatus } from '@nestjs/common';
import { JobManager } from '@app/core/job/job.manager';

@Injectable()
export class JobService {
    constructor(private job_manager: JobManager) {}

    async get_running_jobs() {
        return await this.job_manager.get_running_jobs();
    }

    async update_job(id, data) {
        return await this.job_manager.update(id, data);
    }
}
