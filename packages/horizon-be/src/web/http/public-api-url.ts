import env from '@app/env';

// The public /api/v1 base URL that docs and snippets point at: the backend's public URL (the
// frontend's HORIZON_API_PUB_HTTP_URL is the same plus /api), or the request's own host.
export function public_api_base_url(req: any): string {
    let base = env.HORIZON_BE_PUB_HTTP_URL;
    if (!base) base = `${req.protocol}://${req.get('host')}`;
    while (base.endsWith('/')) base = base.slice(0, -1);
    return `${base}/api/v1`;
}
