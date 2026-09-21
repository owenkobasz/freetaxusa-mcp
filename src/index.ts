#!/usr/bin/env node

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createServer } from './server.js';
import { detachBrowser } from './browser/context.js';

async function main(): Promise<void> {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);

  let shuttingDown = false;
  const shutdown = async (): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    // Leave Chrome running so the next server process can reattach without a
    // new sign-in. Only logout closes it.
    await detachBrowser();
    process.exit(0);
  };

  server.server.onclose = () => {
    void shutdown();
  };
  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());
  process.on('uncaughtException', err => {
    process.stderr.write(`[freetaxusa-mcp] uncaught exception: ${err.message}\n`);
    void shutdown();
  });
}

main().catch(err => {
  process.stderr.write(`Fatal error: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
