import { randomBytes } from 'node:crypto';
import type { SynapseMessage, SynapseConfig, MessageQuery, SynapseTransport } from '../types.js';
import { GitTransport } from './git-transport.js';
import { LarkTransport } from './lark-transport.js';

function generateId(): string {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  return `msg-${date}-${randomBytes(3).toString('hex')}`;
}

function buildTransport(name: string, config: SynapseConfig): SynapseTransport | null {
  if (name === 'git' && config.sync.git?.repo) return new GitTransport(config);
  if (name === 'lark' && config.sync.lark?.appId) return new LarkTransport(config);
  return null;
}

/**
 * All configured transports, ordered by priority.
 * Default priority: git > lark. Override with sync.primary.
 */
function allTransports(config: SynapseConfig): { name: string; transport: SynapseTransport }[] {
  const order: string[] = config.sync.primary === 'lark'
    ? ['lark', 'git']
    : ['git', 'lark'];

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
    throw new Error('No transport configured. Set sync.git or sync.lark in synapse.yaml');
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
    relatedFiles: msg.relatedFiles,
    ...(msg.metadata ? { metadata: msg.metadata } : {}),
  };

  const transports = allTransports(config);
  if (transports.length === 0) {
    throw new Error('No transport configured. Set sync.git or sync.lark in synapse.yaml');
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
 */
export async function pullMessages(
  config: SynapseConfig,
  query?: MessageQuery
): Promise<SynapseMessage[]> {
  const { transport } = primaryTransport(config);
  return transport.pull(query);
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
