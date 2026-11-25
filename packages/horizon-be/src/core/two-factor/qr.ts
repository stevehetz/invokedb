import qrcode from 'qrcode-generator';

/**
 * A QR code of the text as an SVG data URI, drawn here (pure JS, no outside service), so the
 * TOTP secret never leaves the server except to the signed-in owner (#214).
 */
export function qr_svg_data_uri(text: string): string {
    const qr = qrcode(0, 'M');
    qr.addData(text);
    qr.make();
    const count = qr.getModuleCount();
    const margin = 4;
    const size = count + margin * 2;
    let path = '';
    for (let row = 0; row < count; row++) {
        for (let col = 0; col < count; col++) {
            if (qr.isDark(row, col)) path += `M${col + margin} ${row + margin}h1v1h-1z`;
        }
    }
    const svg =
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" ` +
        `shape-rendering="crispEdges"><rect width="${size}" height="${size}" fill="#fff"/>` +
        `<path d="${path}" fill="#000"/></svg>`;
    return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
}
