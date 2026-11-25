import 'dotenv/config';
import express from 'express';
import type { Server as HttpServer } from 'node:http';
import path from 'node:path';
import type { getRequestListener } from '@hono/node-server';

interface ReadyRuntime {
  honoListener: ReturnType<typeof getRequestListener>;
  viteMiddleware: express.RequestHandler | null;
  staticMiddleware: express.RequestHandler | null;
  distIndexFile: string | null;
}

function readCliFlag(flag: string): string | undefined {
  const eqPrefix = `${flag}=`;
  for (let i = 2; i < process.argv.length; i += 1) {
    const arg = process.argv[i];
    if (arg === flag && i + 1 < process.argv.length) {
      return process.argv[i + 1];
    }
    if (arg.startsWith(eqPrefix)) {
      return arg.slice(eqPrefix.length);
    }
  }
  return undefined;
}

function isApiOrMetaPath(reqPath: string): boolean {
  return (
    reqPath.startsWith('/api') ||
    reqPath === '/robots.txt' ||
    reqPath === '/sitemap.xml'
  );
}

async function initRuntime(httpServer: HttpServer): Promise<ReadyRuntime> {
  const [{ createApp }, { getRequestListener: createListener }] = await Promise.all([
    import('./src/server/app.ts'),
    import('@hono/node-server'),
  ]);

  const isProduction = process.env.NODE_ENV === 'production';

  if (!isProduction) {
    const [{ app }, vite] = await Promise.all([
      createApp(),
      import('vite').then(({ createServer: createViteServer }) =>
        createViteServer({
          server: {
            middlewareMode: true,
            hmr: process.env.DISABLE_HMR === 'true' ? false : { server: httpServer },
          },
          appType: 'spa',
        })
      ),
    ]);

    return {
      honoListener: createListener(app.fetch),
      viteMiddleware: vite.middlewares,
      staticMiddleware: null,
      distIndexFile: null,
    };
  }

  const { app } = await createApp();
  const distDir = path.resolve(process.cwd(), 'dist');
  return {
    honoListener: createListener(app.fetch),
    viteMiddleware: null,
    staticMiddleware: express.static(distDir),
    distIndexFile: path.join(distDir, 'index.html'),
  };
}

function resolvePort(): number {
  const cliPort = Number(readCliFlag('--port'));
  if (Number.isFinite(cliPort) && cliPort > 0) {
    return cliPort;
  }
  const envPort = Number(process.env.PORT);
  const nginxPort = Number(process.env.NGINX_PORT);
  if (Number.isFinite(envPort) && envPort > 0 && envPort !== nginxPort) {
    return envPort;
  }
  const defaultPort = Number(process.env.DEFAULT_APP_PORT);
  return Number.isFinite(defaultPort) && defaultPort > 0 ? defaultPort : 3000;
}

function startServer() {
  const expressApp = express();
  const port = resolvePort();
  const host = readCliFlag('--host') || process.env.HOST || '0.0.0.0';

  let readyRuntime: ReadyRuntime | null = null;
  let readyPromise!: Promise<ReadyRuntime>;

  expressApp.get('/api/health', (req, res) => {
    if (!readyRuntime) {
      res.status(200).json({
        ok: true,
        status: 'initializing',
        service: 'Khalid Sharif Digital Library',
        timestamp: new Date().toISOString(),
      });
      return;
    }
    readyRuntime.honoListener(req, res);
  });

  expressApp.use((req, res, next) => {
    readyPromise
      .then((rt) => {
        if (isApiOrMetaPath(req.path)) {
          rt.honoListener(req, res);
          return;
        }
        if (rt.viteMiddleware) {
          rt.viteMiddleware(req, res, next);
          return;
        }
        if (rt.staticMiddleware && rt.distIndexFile) {
          rt.staticMiddleware(req, res, (err) => {
            if (err) {
              next(err);
              return;
            }
            if (req.method === 'GET' && !res.headersSent) {
              res.sendFile(rt.distIndexFile!);
              return;
            }
            next();
          });
          return;
        }
        next();
      })
      .catch(next);
  });

  const httpServer = expressApp.listen(port, host, () => {
    console.log(`Khalid Sharif Digital Library listening on http://${host}:${port}`);
  });

  httpServer.on('error', (err) => {
    console.error('HTTP server bind error:', err);
    process.exit(1);
  });

  readyPromise = initRuntime(httpServer).then((rt) => {
    readyRuntime = rt;
    return rt;
  });

  readyPromise.catch((err) => {
    console.error('Failed to initialize server runtime:', err);
    process.exit(1);
  });
}

startServer();
