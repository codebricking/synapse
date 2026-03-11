#!/usr/bin/env node
import { Command } from 'commander';
import { readFile } from 'fs/promises';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { createMsgCommand } from './cli/msg.js';
import { createServeCommand } from './cli/serve.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const pkg = JSON.parse(await readFile(join(__dirname, '..', 'package.json'), 'utf-8'));

const program = new Command();

program
  .name('synapse')
  .description('AI-to-AI message sync — a dumb pipe for your smart agents')
  .version(pkg.version)
  .option('--config <path>', 'Path to configuration file');

program.addCommand(createMsgCommand());
program.addCommand(createServeCommand());

program.parse();
