import * as http from 'http';
import { AddressInfo } from 'net';
import { assert_public_host, fetch_source } from './url-fetch';
import { UrlImportError } from './url-import';

// A local server stands in for the internet. It's on 127.0.0.1 and a random port, which the
// fetcher refuses, so the tests that need to reach it allow that address and port (`local`)
// and resolve every name to it with a fake lookup.
let server: http.Server;
let port: number;
const routes: { [path: string]: (req, res) => void } = {};

beforeAll(async () => {
    server = http.createServer((req, res) => {
        const path = req.url.split('?')[0];
        const route = Object.hasOwn(routes, path) ? routes[path] : undefined;
        if (typeof route === 'function') route(req, res);
        else {
            res.statusCode = 404;
            res.end('not found');
        }
    });
    await new Promise<void>(r => server.listen(0, '127.0.0.1', () => r()));
    port = (server.address() as AddressInfo).port;
});

afterAll(async () => {
    server.closeAllConnections();
    await new Promise(r => server.close(r));
});

const to_local = ((_host, _opts, cb) => cb(null, [{ address: '127.0.0.1', family: 4 }])) as any;
// Resolves every name to the server and lets the fetcher connect to it
const local_opts = () => ({
    allow_address: (a: string) => a === '127.0.0.1',
    lookup: to_local,
    extra_ports: [String(port)]
});
let local: ReturnType<typeof local_opts>;
beforeAll(() => (local = local_opts()));

const at = (path: string) => `http://data.example.com:${port}${path}`;

const error_of = async (p: Promise<unknown>) => {
    try {
        await p;
    } catch (ex) {
        return ex;
    }
    throw new Error('expected a refusal');
};

describe('fetch_source', () => {
    it('downloads a body and its content type', async () => {
        routes['/a.csv'] = (_req, res) => {
            res.setHeader('Content-Type', 'text/csv');
            res.end('a,b\n1,2\n');
        };
        const res = await fetch_source(at('/a.csv'), local);
        expect(res.body).toBe('a,b\n1,2\n');
        expect(res.content_type).toBe('text/csv');
    });

    it('follows a redirect, and checks where it goes', async () => {
        routes['/moved'] = (_req, res) => {
            res.statusCode = 302;
            res.setHeader('Location', '/a.csv');
            res.end();
        };
        expect((await fetch_source(at('/moved'), local)).url).toBe(at('/a.csv'));

        routes['/to-metadata'] = (_req, res) => {
            res.statusCode = 301;
            res.setHeader('Location', 'http://169.254.169.254/latest/meta-data/');
            res.end();
        };
        const err = await error_of(fetch_source(at('/to-metadata'), local));
        expect(err).toBeInstanceOf(UrlImportError);
        expect(err.message).toMatch(/private or internal/);

        routes['/to-file'] = (_req, res) => {
            res.statusCode = 302;
            res.setHeader('Location', 'file:///etc/passwd');
            res.end();
        };
        expect((await error_of(fetch_source(at('/to-file'), local))).message).toMatch(
            /http and https/
        );
    });

    it('stops after too many redirects', async () => {
        routes['/loop'] = (_req, res) => {
            res.statusCode = 302;
            res.setHeader('Location', '/loop');
            res.end();
        };
        const err = await error_of(fetch_source(at('/loop'), { ...local, max_redirects: 2 }));
        expect(err.message).toMatch(/Too many redirects/);
    });

    it('refuses a body over the size limit, by its length or as it streams', async () => {
        routes['/big'] = (_req, res) => {
            res.setHeader('Content-Length', '5000');
            res.end('x'.repeat(5000));
        };
        routes['/big-chunked'] = (_req, res) => {
            res.write('x'.repeat(3000));
            res.write('x'.repeat(3000));
            res.end();
        };
        const opts = { ...local, max_bytes: 4000 };
        expect((await error_of(fetch_source(at('/big'), opts))).message).toMatch(/larger than/);
        expect((await error_of(fetch_source(at('/big-chunked'), opts))).message).toMatch(
            /larger than/
        );
    });

    it('gives up on a slow server', async () => {
        routes['/slow'] = (_req, res) => {
            res.write('a,b\n');
            setTimeout(() => res.end('1,2\n'), 2000).unref();
        };
        const err = await error_of(fetch_source(at('/slow'), { ...local, timeout_ms: 300 }));
        expect(err).toBeInstanceOf(UrlImportError);
        expect(err.message).toMatch(/longer than/);
    });

    it('reports an HTTP error status', async () => {
        expect((await error_of(fetch_source(at('/missing'), local))).message).toMatch(/HTTP 404/);
    });

    it('refuses a host that resolves to a private address', async () => {
        // The default address rule, with the lookup answering the local server's address
        const extra_ports = local.extra_ports;
        const err = await error_of(fetch_source(at('/a.csv'), { lookup: to_local, extra_ports }));
        expect(err.message).toMatch(/private or internal/);
        const mixed = ((_h, _o, cb) =>
            cb(null, [
                { address: '93.184.215.14', family: 4 },
                { address: '10.0.0.5', family: 4 }
            ])) as any;
        const err2 = await error_of(fetch_source(at('/a.csv'), { lookup: mixed, extra_ports }));
        expect(err2.message).toMatch(/private or internal/);
    });

    it('refuses a private IP literal without looking it up', async () => {
        const extra_ports = local.extra_ports;
        const err = await error_of(fetch_source(`http://127.0.0.1:${port}/a.csv`, { extra_ports }));
        expect(err.message).toMatch(/private or internal/);
    });

    it('refuses other ports', async () => {
        const err = await error_of(fetch_source(at('/a.csv'), { lookup: to_local }));
        expect(err.message).toMatch(/standard ports/);
    });
});

describe('assert_public_host', () => {
    it('refuses names that resolve to private addresses', async () => {
        const lookup = ((_h, _o, cb) => cb(null, [{ address: '192.168.0.10', family: 4 }])) as any;
        const err = await error_of(
            assert_public_host('https://evil.example.com/a.csv', { lookup })
        );
        expect(err).toBeInstanceOf(UrlImportError);
    });

    it('accepts names that resolve to public addresses', async () => {
        const lookup = ((_h, _o, cb) => cb(null, [{ address: '93.184.215.14', family: 4 }])) as any;
        await expect(
            assert_public_host('https://data.example.com/a.csv', { lookup })
        ).resolves.toBeUndefined();
    });

    it('reports a name that does not resolve', async () => {
        const lookup = ((_h, _o, cb) =>
            cb(Object.assign(new Error('x'), { code: 'ENOTFOUND' }))) as any;
        const err = await error_of(assert_public_host('https://nope.example.com/', { lookup }));
        expect(err.message).toMatch(/Could not resolve/);
    });
});
