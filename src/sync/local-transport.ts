import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import type { SynapseMessage, SynapseConfig, MessageQuery, SynapseTransport } from '../types.js';
import { applyQuery } from './git-transport.js';

export class LocalTransport implements SynapseTransport {
  private dir: string;

  constructor(config: SynapseConfig) {
    this.dir = config.sync.local?.dir
      ? config.sync.local.dir
      : join(homedir(), '.synapse', 'local-messages');
  }

  private messagesDir(): string {
    return join(this.dir, 'messages');
  }

  async push(msg: SynapseMessage): Promise<SynapseMessage> {
    const projectDir = join(this.messagesDir(), msg.project);
    await mkdir(projectDir, { recursive: true });

    const date = msg.timestamp.split('T')[0]!;
    const filePath = join(projectDir, `${date}-${msg.id}.json`);
    await writeFile(filePath, JSON.stringify(msg, null, 2), 'utf-8');
    return msg;
  }

  async pull(query?: MessageQuery): Promise<SynapseMessage[]> {
    const dir = this.messagesDir();
    if (!existsSync(dir)) return [];

    const messages: SynapseMessage[] = [];
    const walk = async (d: string) => {
      if (!existsSync(d)) return;
      for (const entry of await readdir(d, { withFileTypes: true })) {
        const full = join(d, entry.name);
        if (entry.isDirectory()) { await walk(full); continue; }
        if (!entry.name.endsWith('.json')) continue;
        try {
          const parsed = JSON.parse(await readFile(full, 'utf-8')) as SynapseMessage;
          if (parsed.id && parsed.timestamp && parsed.title) messages.push(parsed);
        } catch { /* skip */ }
      }
    };
    await walk(dir);

    return applyQuery(messages, query);
  }

  async get(id: string): Promise<SynapseMessage | null> {
    const all = await this.pull();
    return all.find((m) => m.id === id) ?? null;
  }
}
