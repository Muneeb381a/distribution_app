import { ArgumentsHost, Catch, ExceptionFilter, Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { Prisma } from '@prisma/client';
import type { Response } from 'express';
import { AppModule } from './app.module.js';

/** Maps common Prisma errors to proper HTTP statuses instead of a generic 500. */
@Catch(Prisma.PrismaClientKnownRequestError)
class PrismaExceptionFilter implements ExceptionFilter {
  catch(e: Prisma.PrismaClientKnownRequestError, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    const map: Record<string, [number, string]> = {
      P2025: [404, 'Record not found'],
      P2002: [409, 'A record with the same unique value already exists'],
      P2003: [409, 'This record is referenced by other data'],
    };
    const [status, message] = map[e.code] ?? [500, 'Database error'];
    if (status === 500) new Logger('Prisma').error(e.message);
    res.status(status).json({ statusCode: status, message });
  }
}

async function bootstrap() {
  if (process.env.NODE_ENV === 'production' && !process.env.JWT_SECRET) {
    throw new Error('JWT_SECRET must be set in production');
  }
  const app = await NestFactory.create(AppModule);
  app.enableCors({ origin: process.env.WEB_ORIGIN ?? 'http://localhost:3100' });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  app.useGlobalFilters(new PrismaExceptionFilter());
  await app.listen(process.env.PORT ?? 3000);
}
await bootstrap();
