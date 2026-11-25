import { HttpException, HttpStatus } from '@nestjs/common';
import { FormRateLimit } from './form-rate-limit';

const LIMITS = {
    per_ip_per_form: 2,
    per_ip: 3,
    per_form: 4,
    window_ms: 1000,
    per_form_window_ms: 5000
};

const status_of = (fn: () => void) => {
    try {
        fn();
        return 200;
    } catch (err) {
        expect(err).toBeInstanceOf(HttpException);
        return (err as HttpException).getStatus();
    }
};

describe('FormRateLimit', () => {
    it('limits one IP on one form', () => {
        let now = 0;
        const limit = new FormRateLimit(LIMITS, () => now);
        const hits = [1, 2, 3].map(() => status_of(() => limit.check('form_a', '1.1.1.1')));
        expect(hits).toEqual([200, 200, HttpStatus.TOO_MANY_REQUESTS]);
        // The refused hit still counts for the IP, which is now over its limit on every form
        expect(status_of(() => limit.check('form_b', '1.1.1.1'))).toBe(
            HttpStatus.TOO_MANY_REQUESTS
        );
        now = 1000;
        expect(status_of(() => limit.check('form_a', '1.1.1.1'))).toBe(200);
    });

    it('limits one IP on all forms', () => {
        const limit = new FormRateLimit(LIMITS, () => 0);
        const hits = ['form_a', 'form_b', 'form_c', 'form_d'].map(id =>
            status_of(() => limit.check(id, '2.2.2.2'))
        );
        expect(hits).toEqual([200, 200, 200, HttpStatus.TOO_MANY_REQUESTS]);
    });

    it('limits one form from everyone, over its longer window', () => {
        let now = 0;
        const limit = new FormRateLimit(LIMITS, () => now);
        const hits = ['a', 'b', 'c', 'd', 'e'].map(ip =>
            status_of(() => limit.check('form_x', ip))
        );
        expect(hits).toEqual([200, 200, 200, 200, HttpStatus.TOO_MANY_REQUESTS]);
        now = 1000;
        expect(status_of(() => limit.check('form_x', 'f'))).toBe(HttpStatus.TOO_MANY_REQUESTS);
        now = 5000;
        expect(status_of(() => limit.check('form_x', 'f'))).toBe(200);
    });

    it('counts a missing IP as one client', () => {
        const limit = new FormRateLimit(LIMITS, () => 0);
        limit.check('form_a', undefined);
        limit.check('form_a', undefined);
        expect(status_of(() => limit.check('form_a', undefined))).toBe(
            HttpStatus.TOO_MANY_REQUESTS
        );
    });
});
