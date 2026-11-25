import * as http from 'http';
import { AddressInfo } from 'net';
import { send_webhook } from './webhook-send';
import { signature_header, verify_signature } from './webhook';

// A local receiver on 127.0.0.1 and a random port. The sender refuses it unless it's one of the
// test hosts, as the smoke test's receiver is.
let server: http.Server;
let port: number;
let handler: (req: http.IncomingMessage, body: string, res: http.ServerResponse) => void;

beforeAll(async () => {
    server = http.createServer((req, res) => {
        let body = '';
        req.on('data', c => (body += c));
        req.on('end', () => handler(req, body, res));
    });
    await new Promise<void>(r => server.listen(0, '127.0.0.1', () => r()));
    port = (server.address() as AddressInfo).port;
});

afterAll(async () => {
    server.closeAllConnections();
    await new Promise(r => server.close(r));
});

const url = () => `http://127.0.0.1:${port}/hook`;
const test_hosts = () => [`127.0.0.1:${port}`];

describe('send_webhook', () => {
    it('POSTs the body with its headers and a checkable signature', async () => {
        const secret = 'whsec_x';
        const body = JSON.stringify({ event: 'ping' });
        const t = Math.floor(Date.now() / 1000);
        let seen: { method: string; body: string; headers: http.IncomingHttpHeaders };
        handler = (req, b, res) => {
            seen = { method: req.method, body: b, headers: req.headers };
            res.end('thanks');
        };
        const res = await send_webhook(
            url(),
            body,
            { 'InvokeDB-Signature': signature_header(secret, t, body) },
            { test_hosts: test_hosts() }
        );
        expect(res).toMatchObject({ status: 200, error: null, response: 'thanks' });
        expect(seen.method).toBe('POST');
        expect(seen.body).toBe(body);
        expect(seen.headers['content-type']).toBe('application/json');
        expect(seen.headers['user-agent']).toMatch(/^InvokeDB-Webhook/);
        expect(verify_signature(secret, seen.body, seen.headers['invokedb-signature'], t)).toBe(
            true
        );
    });

    it('reports an error status without throwing', async () => {
        handler = (_req, _b, res) => {
            res.statusCode = 503;
            res.end('down');
        };
        const res = await send_webhook(url(), '{}', {}, { test_hosts: test_hosts() });
        expect(res.status).toBe(503);
        expect(res.error).toMatch(/HTTP 503/);
    });

    it("doesn't follow redirects", async () => {
        handler = (_req, _b, res) => {
            res.statusCode = 302;
            res.setHeader('Location', 'http://169.254.169.254/');
            res.end();
        };
        const res = await send_webhook(url(), '{}', {}, { test_hosts: test_hosts() });
        expect(res.status).toBe(302);
        expect(res.error).toMatch(/HTTP 302/);
    });

    it('gives up on a slow receiver', async () => {
        handler = () => {
            // never answers
        };
        const res = await send_webhook(
            url(),
            '{}',
            {},
            { test_hosts: test_hosts(), timeout_ms: 200 }
        );
        expect(res.status).toBe(0);
        expect(res.error).toMatch(/No answer/);
    });

    it('refuses loopback and private addresses that are not test hosts', async () => {
        handler = () => {
            throw new Error('must not be called');
        };
        let res = await send_webhook(url(), '{}', {});
        expect(res.status).toBe(0);
        expect(res.error).toMatch(/standard ports|private/);
        res = await send_webhook('http://127.0.0.1/hook', '{}', {});
        expect(res.error).toMatch(/private or internal/);
    });

    it('refuses a public name that resolves to a private address', async () => {
        const to_loopback = ((_h, _o, cb) =>
            cb(null, [{ address: '127.0.0.1', family: 4 }])) as any;
        const res = await send_webhook(
            'http://hooks.example.com/in',
            '{}',
            {},
            {
                lookup: to_loopback
            }
        );
        expect(res.status).toBe(0);
        expect(res.error).toMatch(/private or internal/);
    });
});
