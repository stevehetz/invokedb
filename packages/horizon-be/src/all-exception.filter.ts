import { ExceptionFilter, Catch, ArgumentsHost, HttpException, HttpStatus } from '@nestjs/common';
import { Request, Response } from 'express';
import logger from '@app/logger';

@Catch()
export class AllExceptionFilter implements ExceptionFilter {
    catch(exception: HttpException, host: ArgumentsHost) {
        const ctx = host.switchToHttp();
        /*const response = ctx.getResponse<Response>()
        const request = ctx.getRequest<Request>()*/

        const stack = exception.stack;
        const response: any = exception.getResponse ? exception.getResponse() : null;
        let status = exception.getStatus ? exception.getStatus() : 500;
        let message = (response && response.message) || exception.message;
        message = status === 500 ? 'Internal Server Error' : message;
        message = Array.isArray(message) ? message[0] : message;
        message = message.message || message.error || message;
        if (status === 400 && message.indexOf('Sort operation used more than the maximum') > -1) {
            message =
                'A sort operation in the requested query caused on out of memory exception. Try adding an index to the column that you would like to sort by.';
            status = 400;
        }

        // Transorm validation messages for front end
        const rules = [];
        if (status === 400) {
            const parse_validation = m => {
                if (m.property && m.constraints) {
                    Object.keys(m.constraints).forEach(conKey => {
                        m.constraints[conKey] = m.constraints[conKey].replace(m.property, 'Value');
                    });
                    rules.push(m);
                }
            };

            if (Array.isArray(response)) {
                response.forEach(parse_validation);
            } else {
                parse_validation(response);
            }

            if (rules.length > 0) {
                message = 'Validation error';
            }
        }

        logger.error(`${status} ${stack}`);

        const json_response: any = {};
        json_response.status = status;

        if (rules.length > 0) {
            json_response.message = 'Validation error';
            json_response.rules = rules;
        } else {
            json_response.message = message;
        }
        // Per-field messages, such as a form submission's wrong answers (#145)
        const errors = response && response.errors;
        if (status === 400 && errors && typeof errors === 'object' && !Array.isArray(errors)) {
            json_response.errors = errors;
        }

        ctx.getResponse<Response>().status(status).json(json_response);
    }
}
