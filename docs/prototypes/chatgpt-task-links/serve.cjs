'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

// 只提供当前原型目录中的页面，不暴露源码仓库或本机其他文件。
const files = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/index.html', ['index.html', 'text/html; charset=utf-8']],
]);
const port = Number(process.env.DEMO_PORT || 4178);
const server = http.createServer((request, response) => {
  const pathname = new URL(request.url, 'http://127.0.0.1').pathname;
  const file = files.get(pathname);
  if (!file || !['GET', 'HEAD'].includes(request.method)) {
    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('未找到演示页面');
    return;
  }
  response.writeHead(200, {
    'Content-Type': file[1],
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy':
      "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; connect-src 'none'; form-action 'none'; base-uri 'none'",
  });
  if (request.method === 'HEAD') response.end();
  else fs.createReadStream(path.join(__dirname, file[0])).pipe(response);
});

server.on('error', (error) => {
  process.stderr.write(`演示服务启动失败：${error.message}\n`);
  process.exitCode = 1;
});
server.listen(port, '127.0.0.1', () => {
  process.stdout.write(`双边交互 Demo：http://127.0.0.1:${port}\n`);
});
