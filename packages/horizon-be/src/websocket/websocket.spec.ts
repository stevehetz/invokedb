jest.mock('@app/env', () => ({
    __esModule: true,
    default: { HORIZON_WS_SERVER_TOKEN: 'srv-token' }
}));

import { SocketServerManager } from './socket-server.manager';
import { SocketClientManager } from './socket-client.manager';
import { WebsocketClientStore } from './client.store';

const PORT = 19000 + Math.floor(Math.random() * 1000);
const URL = `ws://127.0.0.1:${PORT}`;
const ACCOUNT = { id: 7 };

const wait_for = (emitter: SocketClientManager, event: string) =>
    new Promise(resolve => emitter.once(event, resolve));

describe('websocket broker and clients', () => {
    let server: SocketServerManager;
    let clients: SocketClientManager[];

    beforeEach(() => {
        clients = [];
        server = new SocketServerManager('broker');
        server.on('error', () => {});
        server.start_host(PORT, {
            require_auth: true,
            auth_middleware: {
                validate_token: async token => (token === 'user-token' ? ACCOUNT : null)
            }
        });
    });

    afterEach(async () => {
        clients.forEach(c => c.disconnect());
        await server.stop_host();
    });

    /** Connects a client and resolves once the broker has registered it. */
    async function connect(client: SocketClientManager, token: string) {
        clients.push(client);
        client.on('error', () => {});
        client.on('open', () => client.register(token, { server_name: 'test' }));
        const registered = wait_for(client, 'registered');
        client.connect(URL);
        await registered;
        // `updateId` follows `registered`
        await new Promise(resolve => setTimeout(resolve, 50));
    }

    it('registers multi clients under numbered ids', async () => {
        const a = new SocketClientManager('horizon-prc|multi');
        const b = new SocketClientManager('horizon-prc|multi');
        await connect(a, 'srv-token');
        await connect(b, 'srv-token');

        expect(a.id).toBe('horizon-prc_0');
        expect(b.id).toBe('horizon-prc_1');
        expect(Object.keys(server.client_registry).sort()).toEqual([
            'horizon-prc_0',
            'horizon-prc_1'
        ]);
        expect(server.client_registry['horizon-prc_0'].is_secure_client).toBe(true);
    });

    it('rejects a bad token', async () => {
        const client = new SocketClientManager('horizon-fe|multi');
        clients.push(client);
        client.on('open', () => client.register('nope'));
        const got = new Promise(resolve => client.on_message(m => resolve(m.data)));
        client.connect(URL);

        expect(JSON.parse((await got) as string).action).toBe('authentication_failed');
        expect(server.client_registry).toEqual({});
    });

    it('relays direct messages through the client store', async () => {
        const sender_store = new WebsocketClientStore();
        const receiver_store = new WebsocketClientStore();
        await connect(sender_store.create_client('horizon-be'), 'srv-token');
        await connect(receiver_store.create_client('horizon-prc'), 'srv-token');

        const received = new Promise(resolve =>
            receiver_store.on_direct_message('horizon-prc', resolve)
        );
        sender_store.send_direct_message('horizon-be', 'horizon-prc', { event: 'RUN' });

        expect(await received).toEqual({ event: 'RUN' });
    });

    it('relays account messages only to clients of that account', async () => {
        const store = new WebsocketClientStore();
        await connect(store.create_client('horizon-prc'), 'srv-token');

        const browser = new SocketClientManager('horizon-fe|multi');
        await connect(browser, 'user-token');
        const received = new Promise(resolve => browser.on_message(m => resolve(m.data)));

        store.send_direct_message_account('horizon-prc', 'horizon-fe', 7, { progress: 50 });

        expect(JSON.parse((await received) as string)).toEqual({
            senderId: 'horizon-prc_0',
            action: 'directMessage',
            payload: { progress: 50 }
        });
    });
});
