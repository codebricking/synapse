import { Command } from 'commander';
import { startServer } from '../server/index.js';

export function createServeCommand(): Command {
  const cmd = new Command('serve');
  cmd
    .description('Start the HTTP server')
    .option('--port <number>', 'Port number', '3000')
    .option('--host <string>', 'Host to bind', '0.0.0.0');

  cmd.action(async (opts: { port: string; host: string }) => {
    const port = parseInt(opts.port, 10);
    const host = opts.host;
    console.log(`Starting Synapse server on ${host}:${port}...`);
    await startServer({ host, port });
  });

  return cmd;
}
