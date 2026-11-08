import './tz.js';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { configureApp } from './setup.js';

type Handler = (req: IncomingMessage, res: ServerResponse) => void;

/**
 * The same API as main.ts, started once per warm function instance and then reused for every request,
 * for hosts that run it as a serverless function (Vercel).
 */
let ready: Promise<Handler> | null = null;

function start(): Promise<Handler> {
  if (!process.env.JWT_SECRET) throw new Error('JWT_SECRET must be set');
  return (async () => {
    const app = await NestFactory.create(AppModule, { logger: ['error', 'warn'] });
    configureApp(app);
    await app.init();
    return app.getHttpAdapter().getInstance() as Handler;
  })();
}

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  try {
    ready ??= start();
    (await ready)(req, res);
  } catch (e) {
    ready = null; // try a fresh start on the next request
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ statusCode: 500, message: 'The server could not start', detail: process.env.NODE_ENV === 'production' ? undefined : String(e) }));
    console.error(e);
  }
}
