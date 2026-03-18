import { randomBytes } from 'node:crypto';
import type { SynapseMessage, SynapseConfig, MessageQuery, SynapseTransport } from '../types.js';
import { GitTransport } from './git-transport.js';
import { LocalTransport } from './local-transport.js';
import { HttpTransport } from './http-transport.js';
import { LarkWebhookTransport } from './lark-webhook-transport.js';
import { getAckedIds, ackMessage, ackMessages } from './ack-store.js';

function generateId(): string {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  return `msg-${date}-${randomBytes(3).toString('hex')}`;
}

function buildTransport(name: string, config: SynapseConfig): SynapseTransport | null {
  if (name === 'git' && config.sync.git?.repo) return new GitTransport(config);
  if (name === 'local' && config.sync.local) return new LocalTransport(config);
  if (name === 'http' && config.sync.http?.url) return new HttpTransport(config);
  if (name === 'larkWebhook' && config.sync.larkWebhook?.url) return new LarkWebhookTransport(config);
  return null;
}

const DEFAULT_PRIORITY = ['git', 'local', 'http', 'larkWebhook'] as const;

/**
 * All configured transports, ordered by priority.
 * Default priority: git > local > http > larkWebhook.
 * Override primary with sync.primary (only affects pull source).
 */
function allTransports(config: SynapseConfig): { name: string; transport: SynapseTransport }[] {
  const primary = config.sync.primary;
  const order = primary
    ? [primary, ...DEFAULT_PRIORITY.filter((n) => n !== primary)]
    : [...DEFAULT_PRIORITY];

  const result: { name: string; transport: SynapseTransport }[] = [];
  for (const name of order) {
    const t = buildTransport(name, config);
    if (t) result.push({ name, transport: t });
  }
  return result;
}

/**
 * Primary transport (highest priority) for pulling.
 */
function primaryTransport(config: SynapseConfig): { name: string; transport: SynapseTransport } {
  const list = allTransports(config);
  if (list.length === 0) {
    throw new Error('No transport configured. Set sync.git, sync.local, or sync.http in synapse.yaml');
  }
  return list[0]!;
}

/**
 * Returns names of all configured transports, primary first.
 */
export function getTransportNames(config: SynapseConfig): string[] {
  return allTransports(config).map((t) => t.name);
}

export function getTransportName(config: SynapseConfig): string {
  return getTransportNames(config).join('+') || 'none';
}

/**
 * Push to ALL configured transports.
 * Returns the message and a report of which transports succeeded/failed.
 */
export async function pushMessage(
  msg: Omit<SynapseMessage, 'id' | 'timestamp'> & { id?: string; timestamp?: string },
  config: SynapseConfig
): Promise<{ message: SynapseMessage; results: Array<{ transport: string; ok: boolean; error?: string }> }> {
  const full: SynapseMessage = {
    id: msg.id ?? generateId(),
    timestamp: msg.timestamp ?? new Date().toISOString(),
    author: msg.author,
    role: msg.role,
    category: msg.category,
    title: msg.title,
    content: msg.content,
    tags: msg.tags,
    project: msg.project,
    target: msg.target,
    relatedFiles: msg.relatedFiles,
    ...(msg.metadata ? { metadata: msg.metadata } : {}),
  };

  const transports = allTransports(config);
  if (transports.length === 0) {
    throw new Error('No transport configured. Set sync.git, sync.local, or sync.http in synapse.yaml');
  }

  const results = await Promise.all(
    transports.map(async ({ name, transport }) => {
      try {
        await transport.push(full);
        return { transport: name, ok: true };
      } catch (err) {
        return { transport: name, ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    })
  );

  return { message: full, results };
}

/**
 * Pull from PRIMARY transport only.
 * When query.unread is true, filters out messages already acked by this project.
 */
export async function pullMessages(
  config: SynapseConfig,
  query?: MessageQuery
): Promise<SynapseMessage[]> {
  const { transport } = primaryTransport(config);
  let messages = await transport.pull(query);

  if (query?.unread) {
    const ackedIds = await getAckedIds(config.project.name);
    messages = messages.filter((m) => !ackedIds.has(m.id));
  }

  return messages;
}

/**
 * Get from PRIMARY transport only.
 */
export async function getMessage(
  id: string,
  config: SynapseConfig
): Promise<SynapseMessage | null> {
  const { transport } = primaryTransport(config);
  return transport.get(id);
}

/**
 * Mark a single message as processed.
 */
export async function ackMessageById(
  id: string,
  config: SynapseConfig
): Promise<void> {
  await ackMessage(config.project.name, id);
}

/**
 * Mark multiple messages as processed.
 */
export async function ackMessagesByIds(
  ids: string[],
  config: SynapseConfig
): Promise<number> {
  return ackMessages(config.project.name, ids);
}
