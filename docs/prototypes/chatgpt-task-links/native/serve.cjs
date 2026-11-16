'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../../../..');
const app = path.join(root, '.tmp/native-demo-app/browser');
const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.wasm': 'application/wasm',
  '.zip': 'application/zip',
};

// ZIP 的存储模式足够打包两个小插件文件，无需为演示增加依赖。
function pluginZip() {
  const table = Array.from({ length: 256 }, (_, index) => {
    let value = index;
    for (let i = 0; i < 8; i++)
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    return value >>> 0;
  });
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const name of ['manifest.json', 'plugin.js']) {
    const filename = Buffer.from(name);
    const data = fs.readFileSync(path.join(__dirname, 'plugin', name));
    let crc = 0xffffffff;
    for (const byte of data) crc = table[(crc ^ byte) & 255] ^ (crc >>> 8);
    crc = (crc ^ 0xffffffff) >>> 0;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50);
    local.writeUInt16LE(20, 4);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(filename.length, 26);
    locals.push(local, filename, data);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(filename.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, filename);
    offset += local.length + filename.length + data.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(2, 8);
  end.writeUInt16LE(2, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}
function respondFile(response, file) {
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
    response.writeHead(404);
    response.end('未找到页面或应用尚未构建');
    return;
  }
  response.writeHead(200, {
    'Content-Type': mime[path.extname(file)] || 'application/octet-stream',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  fs.createReadStream(file).pipe(response);
}
const server = http.createServer((request, response) => {
  if (request.method !== 'GET') {
    response.writeHead(405);
    response.end();
    return;
  }
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
  } catch {
    response.writeHead(400);
    response.end();
    return;
  }
  if (pathname === '/') {
    response.writeHead(302, { Location: '/native/' });
    response.end();
    return;
  }
  if (pathname === '/native/plugin.zip') {
    response.writeHead(200, {
      'Content-Type': 'application/zip',
      'Content-Disposition': 'attachment; filename="chatgpt-native-demo.zip"',
      'Cache-Control': 'no-store',
    });
    response.end(pluginZip());
    return;
  }
  if (pathname.startsWith('/app/') || pathname.startsWith('/assets/')) {
    const relative = pathname.startsWith('/assets/')
      ? pathname.slice(1)
      : pathname.slice('/app/'.length) || 'index.html';
    const file = path.resolve(app, relative);
    if (!file.startsWith(app + path.sep)) {
      response.writeHead(403);
      response.end();
      return;
    }
    respondFile(response, file);
    return;
  }
  const files = {
    '/native/': 'index.html',
    '/native/host.js': 'host.js',
    '/native/style.css': 'style.css',
  };
  if (files[pathname]) {
    respondFile(response, path.join(__dirname, files[pathname]));
    return;
  }
  response.writeHead(404);
  response.end();
});
server.on('error', (error) => {
  process.stderr.write(`原生演示启动失败：${error.message}\n`);
  process.exitCode = 1;
});
server.listen(Number(process.env.NATIVE_DEMO_PORT || 4179), '127.0.0.1', () =>
  console.log('完整原应用演示：http://127.0.0.1:4179/native/'),
);
