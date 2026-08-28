#!/usr/bin/env node
import 'dotenv/config';

import { serveStdio } from '@modelcontextprotocol/server/stdio';

import { buildApplication } from './app.js';
import { loadConfig } from './config/env.js';
import { createLogger } from './logging/logger.js';
import { serializeSafeError } from './security/safe-error.js';

try {
  const config = loadConfig();
  const logger = createLogger(config.logging.level);
  serveStdio(() => buildApplication(config, logger), {
    onerror: (error) => logger.error('Unhandled MCP transport error.', { errorName: error.name }),
  });
  logger.info('GAM Prebid MCP server ready on stdio.', {
    readOnly: config.gam.readOnly,
    dryRun: config.gam.dryRun,
    networkCode: config.gam.networkCode,
  });
} catch (error) {
  const safeError = serializeSafeError(error);
  process.stderr.write(
    `${JSON.stringify({ level: 'fatal', message: safeError.message, code: safeError.code })}\n`,
  );
  process.exitCode = 1;
}
