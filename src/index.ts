#!/usr/bin/env node
import { Command } from 'commander';
import { createMsgCommand } from './cli/msg.js';
import { createServeCommand } from './cli/serve.js';

const program = new Command();

program
  .name('synapse')
  .description('AI-to-AI message sync — a dumb pipe for your smart agents')
  .version('0.1.0')
  .option('--config <path>', 'Path to configuration file');

program.addCommand(createMsgCommand());
program.addCommand(createServeCommand());

program.parse();
