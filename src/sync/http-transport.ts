import type { SynapseMessage, SynapseConfig, MessageQuery, SynapseTransport } from '../types.js';

/**
 * HTTP Remote Transport — acts as a client to a remote synapse server.
 *
 * PM/designer configures `sync.http.url` pointing to a teammate's
 * `synapse serve` instance. Full read/write, no git or Lark app needed.
 */
export class HttpTransport implements SynapseTransport {
  private baseUrl: string;
  private token?: string;

  constructor(config: SynapseConfig) {
    const http = config.sync.http;
    if (!http?.url) throw new Error('sync.http.url is required for HTTP transport');
    this.baseUrl = http.url.replace(/\/+$/, '');
    this.token = http.token;
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.token) h['Authorization'] = `Bearer ${this.token}`;
    return h;
  }

  async push(msg: SynapseMessage): Promise<SynapseMessage> {
    const res = await fetch(`${this.baseUrl}/api/messages`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({
        title: msg.title,
        content: msg.content,
        role: msg.role,
        category: msg.category,
        author: msg.author,
        project: msg.project,
        tags: msg.tags,
        relatedFiles: msg.relatedFiles,
        metadata: msg.metadata,
        id: msg.id,
        timestamp: msg.timestamp,
      }),
    });

    const data = await res.json() as { success?: boolean; message?: SynapseMessage; error?: string };
    if (!res.ok || !data.success) {
      throw new Error(`HTTP push failed: ${data.error ?? res.statusText}`);
    }
    return data.message ?? msg;
  }

  async pull(query?: MessageQuery): Promise<SynapseMessage[]> {
    const url = new URL(`${this.baseUrl}/api/messages`);
    if (query?.since) url.searchParams.set('since', query.since);
    if (query?.role) url.searchParams.set('role', query.role);
    if (query?.category) url.searchParams.set('category', query.category);
    if (query?.project) url.searchParams.set('project', query.project);
    if (query?.assignTo) url.searchParams.set('assignTo', query.assignTo);
    if (query?.limit) url.searchParams.set('limit', String(query.limit));

    const res = await fetch(url.toString(), { headers: this.headers() });
    const data = await res.json() as { messages?: SynapseMessage[]; error?: string };
    if (!res.ok) {
      throw new Error(`HTTP pull failed: ${data.error ?? res.statusText}`);
    }
    return data.messages ?? [];
  }

  async get(id: string): Promise<SynapseMessage | null> {
    const res = await fetch(`${this.baseUrl}/api/messages/${encodeURIComponent(id)}`, {
      headers: this.headers(),
    });
    if (res.status === 404) return null;
    if (!res.ok) {
      const data = await res.json() as { error?: string };
      throw new Error(`HTTP get failed: ${data.error ?? res.statusText}`);
    }
    return await res.json() as SynapseMessage;
  }
}
