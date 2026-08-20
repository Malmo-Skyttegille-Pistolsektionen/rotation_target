import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const swaggerUiDist = require('swagger-ui-dist');

const swaggerUiDir = swaggerUiDist.getAbsoluteFSPath();
const specPath = fileURLToPath(new URL('../docs/mock-api-v2.openapi.json', import.meta.url));
const specYamlPath = fileURLToPath(new URL('../docs/mock-api-v2.openapi.yaml', import.meta.url));
const requestedPort = Number.parseInt(process.env.SWAGGER_PORT ?? '8095', 10);

if (Number.isNaN(requestedPort)) {
  throw new Error('SWAGGER_PORT must be a valid integer.');
}

const MIME_TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ttf': 'font/ttf',
  '.woff2': 'font/woff2',
};

function getContentType(filePath: string): string {
  return MIME_TYPES[path.extname(filePath)] ?? 'application/octet-stream';
}

function getIndexHtml(): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Rotation Target Mock API v2</title>
    <link rel="stylesheet" href="/swagger-ui.css" />
  </head>
  <body>
    <div id="swagger-ui"></div>
    <script src="/swagger-ui-bundle.js" charset="utf-8"></script>
    <script src="/swagger-ui-standalone-preset.js" charset="utf-8"></script>
    <script src="/swagger-initializer.js" charset="utf-8"></script>
  </body>
</html>`;
}

function getSwaggerInitializer(): string {
  return `window.onload = function () {
  window.ui = SwaggerUIBundle({
    url: '/openapi.json',
    dom_id: '#swagger-ui',
    deepLinking: true,
    presets: [SwaggerUIBundle.presets.apis, SwaggerUIStandalonePreset],
    layout: 'StandaloneLayout'
  });
};`;
}

async function sendFile(res: ServerResponse, filePath: string): Promise<void> {
  try {
    const body = await readFile(filePath);
    res.writeHead(200, {
      'Content-Type': getContentType(filePath),
      'Cache-Control': 'no-cache',
    });
    res.end(body);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not found');
  }
}

function getListeningPort(): number | null {
  const address = server.address();

  if (address && typeof address !== 'string') {
    return (address as AddressInfo).port;
  }

  return null;
}

const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
  const requestUrl = new URL(req.url ?? '/', 'http://localhost');

  if (requestUrl.pathname === '/' || requestUrl.pathname === '/index.html') {
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-cache',
    });
    res.end(getIndexHtml());
    return;
  }

  if (requestUrl.pathname === '/swagger-initializer.js') {
    res.writeHead(200, {
      'Content-Type': 'text/javascript; charset=utf-8',
      'Cache-Control': 'no-cache',
    });
    res.end(getSwaggerInitializer());
    return;
  }

  if (requestUrl.pathname === '/openapi.json') {
    await sendFile(res, specPath);
    return;
  }

  if (requestUrl.pathname === '/openapi.yaml') {
    await sendFile(res, specYamlPath);
    return;
  }

  const assetPath = path.resolve(swaggerUiDir, `.${requestUrl.pathname}`);
  const allowedRoot = `${swaggerUiDir}${path.sep}`;

  if (!assetPath.startsWith(allowedRoot)) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Forbidden');
    return;
  }

  await sendFile(res, assetPath);
});

function listen(port: number): void {
  server.listen(port, () => {
    const actualPort = getListeningPort();
    console.log(`Swagger UI running at http://localhost:${actualPort}`);
    console.log('Serving spec: docs/mock-api-v2.openapi.json');
  });
}

server.on('error', (error: NodeJS.ErrnoException) => {
  if (error.code === 'EADDRINUSE') {
    const fallbackPort = requestedPort + 1;
    console.warn(`Port ${requestedPort} busy, retrying on ${fallbackPort}`);
    server.removeAllListeners('error');
    listen(fallbackPort);
    return;
  }

  throw error;
});

listen(requestedPort);
