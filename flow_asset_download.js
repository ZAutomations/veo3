const { hasVideoContainer } = require('./download_media_validation');

// Chrome's authenticated network loader follows the /asb redirect using the
// current browser session. Unlike page.fetch it is not subject to the CDN's
// missing CORS headers; unlike Node fetch it has the correct Google cookies.
async function downloadFlowAsset(page, url) {
    const client = await page.createCDPSession();
    let stream;
    try {
        const tree = await client.send('Page.getFrameTree');
        const { resource } = await client.send('Network.loadNetworkResource', {
            frameId: tree.frameTree.frame.id, url,
            options: { disableCache: false, includeCredentials: true },
        });
        stream = resource.stream;
        if (!resource.success || !stream || resource.httpStatusCode >= 400) {
            return { ok: false, why: `Browser asset load failed (${resource.httpStatusCode || resource.netErrorName || 'no stream'}).` };
        }
        const chunks = [];
        while (true) {
            const chunk = await client.send('IO.read', { handle: stream, size: 1048576 });
            chunks.push(Buffer.from(chunk.data, chunk.base64Encoded ? 'base64' : 'utf8'));
            if (chunk.eof) break;
        }
        const buf = Buffer.concat(chunks);
        return hasVideoContainer(buf) ? { ok: true, buf }
            : { ok: false, why: 'Browser returned non-video data; nothing saved as MP4.' };
    } catch (e) {
        return { ok: false, why: String(e.message).slice(0, 180) };
    } finally {
        if (stream) await client.send('IO.close', { handle: stream }).catch(() => {});
        await client.detach().catch(() => {});
    }
}

module.exports = { downloadFlowAsset };
