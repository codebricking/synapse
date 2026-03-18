import { Command } from 'commander';
import { loadConfig } from '../config.js';
import { pushMessage, pullMessages, getTransportNames, ackMessageById, ackMessagesByIds } from '../sync/messages.js';
import { C } from './colors.js';

export function createMsgCommand(): Command {
  const cmd = new Command('msg');
  cmd.description('Send or list sync messages across team roles');

  // ── send ─────────────────────────────────────────────

  const send = new Command('send');
  send
    .description('Push to all configured transports')
    .argument('<title>', 'Message title')
    .requiredOption('--role <role>', 'Your role (backend|frontend|pm|design|qa)')
    .option('--category <cat>', 'Category (api_change|requirement|decision|status|bug|note)', 'note')
    .option('--content <text>', 'Message body', '')
    .option('--tags <tags>', 'Comma-separated tags')
    .option('--files <files>', 'Comma-separated related file paths')
    .option('--target <name>', 'Target MD file name (e.g. api-user, decisions)')
    .option('--metadata <json>', 'Structured metadata as JSON string');

  send.action(async (
    title: string,
    opts: { role: string; category: string; content: string; tags?: string; files?: string; target?: string; metadata?: string },
    command: Command
  ) => {
    const configPath = command?.parent?.parent?.opts?.()?.config as string | undefined;
    const config = await loadConfig(configPath);

    let metadata: Record<string, unknown> | undefined;
    if (opts.metadata) {
      try { metadata = JSON.parse(opts.metadata); }
      catch { console.error(`${C.red}Invalid --metadata JSON${C.reset}`); process.exit(1); }
    }

    const { message, results } = await pushMessage(
      {
        author: process.env.USER ?? process.env.USERNAME ?? 'unknown',
        role: opts.role,
        category: opts.category,
        title,
        content: opts.content || title,
        tags: opts.tags?.split(',').map((t) => t.trim()),
        project: config.project.name,
        target: opts.target,
        relatedFiles: opts.files?.split(',').map((f) => f.trim()),
        metadata,
      },
      config
    );

    console.log(`${C.green}\u2713 ${message.id}${C.reset} ${C.dim}[${message.category}] ${message.title}${C.reset}`);
    for (const r of results) {
      const icon = r.ok ? `${C.green}\u2713${C.reset}` : `${C.red}\u2717${C.reset}`;
      const err = r.error ? ` ${C.dim}(${r.error})${C.reset}` : '';
      console.log(`  ${icon} ${r.transport}${err}`);
    }
  });

  // ── list ─────────────────────────────────────────────

  const list = new Command('list');
  list
    .description('Pull from primary transport')
    .option('--since <date>', 'Since date (ISO format, default: last 7 days)')
    .option('--role <role>', 'Filter by sender role')
    .option('--category <cat>', 'Filter by category (bug, api_change, requirement...)')
    .option('--assign-to <role>', 'Filter by metadata.assignTo (e.g. frontend)')
    .option('--limit <n>', 'Max messages to show', '20')
    .option('--unread', 'Only show unprocessed messages (skip already acked)')
    .option('--ack', 'Auto-ack all returned messages after listing')
    .option('--json', 'Output as JSON');

  list.action(async (
    opts: { since?: string; role?: string; category?: string; assignTo?: string; limit: string; unread?: boolean; ack?: boolean; json?: boolean },
    command: Command
  ) => {
    const configPath = command?.parent?.parent?.opts?.()?.config as string | undefined;
    const config = await loadConfig(configPath);

    const since = opts.since ?? new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const messages = await pullMessages(config, {
      since,
      role: opts.role,
      category: opts.category,
      assignTo: opts.assignTo,
      limit: parseInt(opts.limit, 10),
      unread: opts.unread,
    });

    if (opts.json) {
      console.log(JSON.stringify(messages, null, 2));
    } else {
      const names = getTransportNames(config);
      const label = opts.unread ? 'Unread messages' : 'Messages';
      console.log(`${C.bold}${C.cyan}${label} from ${names[0] ?? '?'} (since ${since.slice(0, 10)})${C.reset}\n`);

      if (messages.length === 0) {
        console.log(`${C.dim}No messages found.${C.reset}`);
        return;
      }

      const catIcons: Record<string, string> = {
        bug: '\u{1F41B}', api_change: '\u{1F504}', requirement: '\u{1F4CB}',
        decision: '\u{2696}\u{FE0F}', status: '\u{1F4E2}', note: '\u{1F4DD}',
      };

      const currentProject = config.project.name;
      for (const m of messages) {
        const icon = catIcons[m.category] ?? '\u{1F4AC}';
        const roleColor = m.role === 'backend' ? C.blue : m.role === 'frontend' ? C.green : C.yellow;
        const meta = m.metadata as Record<string, unknown> | undefined;
        const severity = meta?.severity ? ` [${meta.severity}]` : '';
        const assignTo = meta?.assignTo ? ` \u2192 ${meta.assignTo}` : '';
        const projectTag = m.project !== currentProject ? ` ${C.dim}(${m.project})${C.reset}` : '';

        console.log(
          `  ${icon} ${C.dim}${m.timestamp.slice(0, 16)}${C.reset} ${roleColor}[${m.role}]${C.reset}${projectTag} ${C.bold}${m.title}${C.reset}${C.red}${severity}${C.reset}${C.cyan}${assignTo}${C.reset}`
        );
        const preview = m.content.length > 80 ? m.content.slice(0, 80) + '...' : m.content;
        console.log(`    ${C.dim}${preview}${C.reset}`);
        console.log();
      }

      console.log(`${C.dim}Total: ${messages.length} message(s)${C.reset}`);
    }

    if (opts.ack && messages.length > 0) {
      const count = await ackMessagesByIds(messages.map((m) => m.id), config);
      if (!opts.json) {
        console.log(`${C.green}\u2713 Acked ${count} message(s)${C.reset}`);
      }
    }
  });

  // ── ack ──────────────────────────────────────────────

  const ack = new Command('ack');
  ack
    .description('Mark message(s) as processed (prevents re-processing)')
    .argument('<ids...>', 'Message ID(s) to ack');

  ack.action(async (
    ids: string[],
    command: Command
  ) => {
    const configPath = command?.parent?.parent?.opts?.()?.config as string | undefined;
    const config = await loadConfig(configPath);
    const count = await ackMessagesByIds(ids, config);
    console.log(`${C.green}\u2713 Acked ${count} new message(s)${C.reset} ${C.dim}(${ids.length} requested, ${ids.length - count} already acked)${C.reset}`);
  });

  cmd.addCommand(send);
  cmd.addCommand(list);
  cmd.addCommand(ack);
  return cmd;
}
