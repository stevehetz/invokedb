/**
 * The JSON frames the websocket broker and its clients exchange. The field names are the wire
 * format shared with the frontend (`horizon-fe`), so they stay camelCase.
 */
export type WsAction =
    | 'register'
    | 'registered'
    | 'updateId'
    | 'authentication_failed'
    | 'ping'
    | 'pong'
    | 'subscribe'
    | 'directMessage'
    | 'directMessageAccount'
    | 'totalClients'
    | 'clients'
    | 'broadcast'
    | 'toServer'
    | 'status'
    | 'error';

export interface WsMessage {
    action: WsAction;
    senderId?: string | null;
    recipientId?: string;
    accountId?: unknown;
    payload?: unknown;
}

export interface WsRegisterPayload {
    id: string;
    token?: string;
    metadata?: Record<string, any>;
}
