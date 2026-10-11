import http from 'node:http';
import https from 'node:https';
import net from 'node:net';

// Network isolation without Playwright interception: WebKit's interception
// machinery can buffer even non-matching streaming WebChannel requests.
// Only exact configured synthetic origins may traverse this local proxy.
export async function createEmulatorIsolation(origins) {
  const allowed = new Set(origins.map(origin => new URL(origin).origin));
  const sockets = new Set();
  const server = http.createServer((request, response) => {
    let target;
    try { target = new URL(request.url); } catch { response.writeHead(400).end(); return; }
    if (!allowed.has(target.origin) || target.username || target.password) { response.writeHead(403).end(); return; }
    const headers = {...request.headers}; delete headers['proxy-connection'];
    const upstream = (target.protocol === 'https:' ? https : http).request(target,
      {method: request.method, headers}, result => {
        response.writeHead(result.statusCode, result.headers);
        result.pipe(response); // Never aggregate a streaming response body.
      });
    upstream.on('error', () => { if (!response.headersSent) response.writeHead(502); response.end(); });
    response.on('close', () => upstream.destroy());
    request.pipe(upstream);
  });
  server.on('connect', (request, client, head) => {
    let target;
    try { target = new URL(`https://${request.url}`); } catch { client.destroy(); return; }
    if (!allowed.has(target.origin) || target.username || target.password || target.pathname !== '/') {
      client.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); return;
    }
    const upstream = net.connect(Number(target.port || 443), target.hostname, () => {
      client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (head.length) upstream.write(head);
      upstream.pipe(client); client.pipe(upstream);
    });
    sockets.add(upstream); upstream.on('close', () => sockets.delete(upstream));
    upstream.on('error', () => client.destroy()); client.on('close', () => upstream.destroy());
  });
  server.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  return {server: `http://127.0.0.1:${server.address().port}`, close: async () => {
    for (const socket of sockets) socket.destroy();
    await new Promise(resolve => server.close(resolve));
  }};
}
