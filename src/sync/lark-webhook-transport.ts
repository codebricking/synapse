import type { SynapseMessage, SynapseConfig, MessageQuery, SynapseTransport } from '../types.js';

/**
 * Lark Webhook Transport — push-only, zero approval needed.
 *
 * Just add a custom bot in a Feishu group chat, copy the webhook URL.
 * No enterprise app, no appId/appSecret, no admin approval.
 *
 * Pull/get always return empty — webhook is one-way.
 */
export class LarkWebhookTransport implements SynapseTransport {
  private webhookUrl: string;

  constructor(config: SynapseConfig) {
    const url = config.sync.larkWebhook?.url;
    if (!url) throw new Error('sync.larkWebhook.url is required');
    this.webhookUrl = url;
  }

  async push(msg: SynapseMessage): Promise<SynapseMessage> {
    const roleBadge: Record<string, string> = {
      backend: '\u{1F527}', frontend: '\u{1F4F1}', pm: '\u{1F4CB}',
      design: '\u{1F3A8}', qa: '\u{1F50D}',
    };
    const catBadge: Record<string, string> = {
      bug: '\u{1F41B}', api_change: '\u{1F504}', requirement: '\u{1F4CB}',
      decision: '\u2696\uFE0F', status: '\u{1F4E2}', note: '\u{1F4DD}',
    };
    const icon = roleBadge[msg.role] ?? '\u{1F4AC}';
    const catIcon = catBadge[msg.category] ?? '';

    const meta = msg.metadata as Record<string, unknown> | undefined;
    const severity = meta?.severity ? ` [${meta.severity}]` : '';
    const assignTo = meta?.assignTo ? `\n\u27A1\uFE0F \u5206\u914D\u7ED9: ${meta.assignTo}` : '';

    const card = {
      msg_type: 'interactive' as const,
      card: {
        header: {
          title: { tag: 'plain_text' as const, content: `${icon} ${msg.title}` },
          template: msg.category === 'bug' ? 'red'
            : msg.category === 'api_change' ? 'blue'
            : msg.category === 'requirement' ? 'purple'
            : 'turquoise',
        },
        elements: [
          {
            tag: 'div' as const,
            text: {
              tag: 'lark_md' as const,
              content: [
                `${catIcon} **${msg.category}**${severity}  |  **${msg.role}**  |  ${msg.project}`,
                '',
                msg.content.length > 500 ? msg.content.slice(0, 500) + '...' : msg.content,
                assignTo,
                msg.tags?.length ? `\n**\u6807\u7B7E**: ${msg.tags.join(', ')}` : '',
              ].filter(Boolean).join('\n'),
            },
          },
          {
            tag: 'note' as const,
            elements: [
              { tag: 'plain_text' as const, content: `synapse | ${msg.id} | ${msg.timestamp.slice(0, 16)}` },
            ],
          },
        ],
      },
    };

    const res = await fetch(this.webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(card),
    });

    const data = await res.json() as { code?: number; msg?: string; StatusCode?: number; StatusMessage?: string };
    const code = data.code ?? data.StatusCode ?? -1;
    if (code !== 0) {
      throw new Error(`Lark webhook failed: ${data.msg ?? data.StatusMessage ?? 'unknown error'}`);
    }

    return msg;
  }

  async pull(_query?: MessageQuery): Promise<SynapseMessage[]> {
    return [];
  }

  async get(_id: string): Promise<SynapseMessage | null> {
    return null;
  }
}
