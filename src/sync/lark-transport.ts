import type { SynapseMessage, SynapseConfig, MessageQuery, SynapseTransport } from '../types.js';
import { applyQuery } from './git-transport.js';

const FEISHU_BASE = 'https://open.feishu.cn/open-apis';
const SYNAPSE_MARKER = '[synapse-data]';

/**
 * Feishu/Lark transport — uses the Open API for bidirectional read/write.
 *
 * Push: sends a card message (human-readable) to the chat group,
 *       with a hidden note element containing the full JSON payload.
 * Pull: lists messages from the chat group, filters for synapse markers,
 *       decodes the JSON payload.
 */
export class LarkTransport implements SynapseTransport {
  private appId: string;
  private appSecret: string;
  private chatId: string;
  private tokenCache: { token: string; expiresAt: number } | null = null;

  constructor(config: SynapseConfig) {
    const lark = config.sync.lark;
    if (!lark?.appId || !lark?.appSecret || !lark?.chatId) {
      throw new Error('sync.lark requires appId, appSecret, and chatId');
    }
    this.appId = lark.appId;
    this.appSecret = lark.appSecret;
    this.chatId = lark.chatId;
  }

  private async getToken(): Promise<string> {
    if (this.tokenCache && Date.now() < this.tokenCache.expiresAt) {
      return this.tokenCache.token;
    }

    const res = await fetch(`${FEISHU_BASE}/auth/v3/tenant_access_token/internal`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ app_id: this.appId, app_secret: this.appSecret }),
    });

    const data = await res.json() as {
      code: number;
      msg: string;
      tenant_access_token?: string;
      expire?: number;
    };

    if (data.code !== 0 || !data.tenant_access_token) {
      throw new Error(`Feishu auth failed: ${data.msg}`);
    }

    this.tokenCache = {
      token: data.tenant_access_token,
      expiresAt: Date.now() + (data.expire ?? 7200) * 1000 - 60_000,
    };
    return this.tokenCache.token;
  }

  private buildCard(msg: SynapseMessage): string {
    const roleBadge: Record<string, string> = {
      backend: '\u{1F527}', frontend: '\u{1F4F1}', pm: '\u{1F4CB}',
      design: '\u{1F3A8}', qa: '\u{1F50D}',
    };
    const icon = roleBadge[msg.role] ?? '\u{1F4AC}';

    const encoded = Buffer.from(JSON.stringify(msg)).toString('base64');

    const card = {
      header: {
        title: { tag: 'plain_text', content: `${icon} ${msg.title}` },
        template: msg.category === 'api_change' ? 'blue' : 'turquoise',
      },
      elements: [
        {
          tag: 'div',
          text: {
            tag: 'lark_md',
            content: [
              `**项目**：${msg.project}  |  **角色**：${msg.role}  |  **类别**：${msg.category}`,
              `**作者**：${msg.author}`,
              '',
              msg.content,
              msg.tags?.length ? `\n**标签**：${msg.tags.join(', ')}` : '',
            ].filter(Boolean).join('\n'),
          },
        },
        {
          tag: 'note',
          elements: [{ tag: 'plain_text', content: `${SYNAPSE_MARKER}${encoded}` }],
        },
      ],
    };

    return JSON.stringify(card);
  }

  async push(msg: SynapseMessage): Promise<SynapseMessage> {
    const token = await this.getToken();

    const res = await fetch(
      `${FEISHU_BASE}/im/v1/messages?receive_id_type=chat_id`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          receive_id: this.chatId,
          msg_type: 'interactive',
          content: this.buildCard(msg),
        }),
      },
    );

    const data = await res.json() as { code: number; msg: string };
    if (data.code !== 0) {
      throw new Error(`Feishu send failed: ${data.msg}`);
    }

    return msg;
  }

  async pull(query?: MessageQuery): Promise<SynapseMessage[]> {
    const token = await this.getToken();
    const messages: SynapseMessage[] = [];
    let pageToken: string | undefined;
    let pages = 0;
    const maxPages = 5;

    do {
      const url = new URL(`${FEISHU_BASE}/im/v1/messages`);
      url.searchParams.set('container_id_type', 'chat');
      url.searchParams.set('container_id', this.chatId);
      url.searchParams.set('page_size', '50');
      if (pageToken) url.searchParams.set('page_token', pageToken);

      const res = await fetch(url.toString(), {
        headers: { Authorization: `Bearer ${token}` },
      });

      const data = await res.json() as {
        code: number;
        msg: string;
        data?: {
          items?: Array<{ msg_type: string; body?: { content?: string } }>;
          page_token?: string;
          has_more?: boolean;
        };
      };

      if (data.code !== 0) {
        throw new Error(`Feishu list messages failed: ${data.msg}`);
      }

      for (const item of data.data?.items ?? []) {
        const parsed = this.extractMessage(item);
        if (parsed) messages.push(parsed);
      }

      pageToken = data.data?.has_more ? data.data.page_token : undefined;
      pages++;
    } while (pageToken && pages < maxPages);

    return applyQuery(messages, query);
  }

  private extractMessage(item: { msg_type: string; body?: { content?: string } }): SynapseMessage | null {
    if (item.msg_type !== 'interactive') return null;
    const content = item.body?.content;
    if (!content) return null;

    try {
      const card = JSON.parse(content) as {
        elements?: Array<{
          tag: string;
          elements?: Array<{ tag: string; content?: string }>;
        }>;
      };

      for (const el of card.elements ?? []) {
        if (el.tag !== 'note') continue;
        for (const sub of el.elements ?? []) {
          if (!sub.content?.startsWith(SYNAPSE_MARKER)) continue;
          const b64 = sub.content.slice(SYNAPSE_MARKER.length);
          const json = Buffer.from(b64, 'base64').toString('utf-8');
          const msg = JSON.parse(json) as SynapseMessage;
          if (msg.id && msg.timestamp && msg.title) return msg;
        }
      }
    } catch {
      // not a synapse message
    }
    return null;
  }

  async get(id: string): Promise<SynapseMessage | null> {
    const all = await this.pull();
    return all.find((m) => m.id === id) ?? null;
  }
}
