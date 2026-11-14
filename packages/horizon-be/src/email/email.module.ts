import { Module } from '@nestjs/common';
import { EmailManager } from './email.manager';

@Module({
    providers: [EmailManager],
    exports: [EmailManager]
})
export class EmailModule {}
