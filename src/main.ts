import 'dotenv/config';

// Monkey-patch the ZK SDK's broken readWithBuffer method.
// The original code calls reject(err) without returning, causing reply.subarray()
// to throw on undefined. This patch adds the missing return statement.
// Must run before any code that requires('zk-attendance-sdk').
try {
  const fs = require('fs');
  const path = require('path');
  const jtcpPath = path.join(
    process.cwd(),
    'node_modules',
    'zk-attendance-sdk',
    'src',
    'jtcp.js',
  );
  if (fs.existsSync(jtcpPath)) {
    let src = fs.readFileSync(jtcpPath, 'utf-8');
    // The bug: reject(err) without return, then console.log(reply) then }
    // This pattern may have \r\n (Windows) or \n (Unix) line endings
    const bugPattern = /reject\(err\)\r?\n\s+console\.log\(reply\)\r?\n\r?\n\s+\}/;
    if (bugPattern.test(src)) {
      src = src.replace(bugPattern, 'reject(err)\n        return\n      }');
      fs.writeFileSync(jtcpPath, src, 'utf-8');
    }
  }
} catch {
  // If patching fails, continue -- the unhandledRejection handler below provides a fallback
}

// Safety net for any unhandled rejections that slip through
process.on('unhandledRejection', (reason) => {
  if (reason instanceof TypeError && reason.message?.includes('subarray')) {
    return;
  }
  console.error('Unhandled rejection:', reason);
});

import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import * as express from 'express';
import * as path from 'path';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const corsOrigins = process.env.CORS_ORIGIN?.split(',').map((o) => o.trim()).filter(Boolean);
  
  app.enableCors({
    origin: (origin, callback) => {
      // If no origin (like mobile apps or curl), allow it
      if (!origin) return callback(null, true);

      // If no allowed origins specified, reflect the requesting origin
      if (!corsOrigins || corsOrigins.length === 0) {
        return callback(null, origin);
      }

      // Check if origin matches any of the allowed origins
      if (corsOrigins.includes(origin) || corsOrigins.includes('*')) {
        callback(null, origin);
      } else {
        console.warn(`CORS blocked for origin: ${origin}. Allowed: ${corsOrigins.join(', ')}`);
        callback(new Error('Not allowed by CORS'));
      }
    },
    credentials: true,
    methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'Accept',
      'X-User-Name',
      'X-User-Id',
    ],
  });
  app.use('/uploads', express.static(path.join(process.cwd(), 'uploads')));
  const port = process.env.PORT || 3000;
  await app.listen(port);
}
bootstrap();
