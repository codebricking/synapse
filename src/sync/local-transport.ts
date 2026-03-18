import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import type { SynapseMessage, SynapseConfig, MessageQuery, SynapseTransport } from '../types.js';
import { applyQuery } from './git-transport.js';
import { resolveTarget, createDocument, upsertSection, parseSections, sectionsToMessages } from './md-parser.js';

export class LocalTransport implements SynapseTransport {
  private dir: string;

  constructor(config: SynapseConfig) {
    this.dir = config.sync.local?.dir
      ? config.sync.local.dir
      : join(homedir(), '.synapse', 'local-messages');
  }

  private projectsDir(): string {
    return join(this.dir, 'projects');
  }

  private mdFilePath(project: string, target: string): string {
    return join(this.projectsDir(), project, `${target}.md`);
  }

  async push(msg: SynapseMessage): Promise<SynapseMessage> {
    const target = resolveTarget(msg);
    const projectDir = join(this.projectsDir(), msg.project);
    await mkdir(projectDir, { recursive: true });

    const filePath = this.mdFilePath(msg.project, target);
    let updatedContent: string;

    if (existsSync(filePath)) {
      const existing = await readFile(filePath, 'utf-8');
      updatedContent = upsertSection(existing, msg);
    } else {
      updatedContent = createDocument(msg, target);
    }

    await writeFile(filePath, updatedContent, 'utf-8');
    return msg;
  }

  async pull(query?: MessageQuery): Promise<SynapseMessage[]> {
    const dir = this.projectsDir();
    if (!existsSync(dir)) return [];

    const messages: SynapseMessage[] = [];

    for (const projectEntry of await readdir(dir, { withFileTypes: true })) {
      if (!projectEntry.isDirectory()) continue;
      const projectName = projectEntry.name;
      const projectDir = join(dir, projectName);

      for (const fileEntry of await readdir(projectDir, { withFileTypes: true })) {
        if (!fileEntry.name.endsWith('.md')) continue;
        const target = fileEntry.name.replace(/\.md$/, '');
        try {
          const content = await readFile(join(projectDir, fileEntry.name), 'utf-8');
          const sections = parseSections(content);
          messages.push(...sectionsToMessages(sections, projectName, target));
        } catch { /* skip */ }
      }
    }

    return applyQuery(messages, query);
  }

  async get(id: string): Promise<SynapseMessage | null> {
    const all = await this.pull();
    return all.find((m) => m.id === id) ?? null;
  }
}
