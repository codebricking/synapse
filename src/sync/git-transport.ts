import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import simpleGit from 'simple-git';
import type { SynapseMessage, SynapseConfig, MessageQuery, SynapseTransport } from '../types.js';

function repoName(repo: string): string {
  const match = repo.match(/\/([^/]+?)(?:\.git)?$/);
  return match ? match[1]!.replace(/[^a-zA-Z0-9._-]/g, '_') : 'repo';
}

export class GitTransport implements SynapseTransport {
  private localPath: string;
  private repo: string;
  private branch: string;

  constructor(config: SynapseConfig) {
    const git = config.sync.git;
    if (!git?.repo) throw new Error('sync.git.repo is required for Git transport');
    this.repo = git.repo;
    this.branch = git.branch ?? 'main';
    this.localPath = join(homedir(), '.synapse', 'repos', repoName(this.repo));
  }

  private async ensureRepo() {
    if (!existsSync(this.localPath)) {
      await mkdir(join(homedir(), '.synapse', 'repos'), { recursive: true });
      try {
        await simpleGit().clone(this.repo, this.localPath, ['-b', this.branch]);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new Error(
          `Failed to clone synapse git repo: ${this.repo}\n` +
          `Error: ${msg}\n\n` +
          `This is the shared message repo (NOT your project repo). Fix steps:\n` +
          `  1. Verify the repo exists and you have access\n` +
          `  2. Check git credentials: git clone ${this.repo} /tmp/synapse-test\n` +
          `  3. Or manually clone: mkdir -p ~/.synapse/repos && git clone ${this.repo} ${this.localPath}\n` +
          `  4. If the repo doesn't exist yet, create it first`
        );
      }
    }
    const git = simpleGit(this.localPath);
    try {
      await git.pull('origin', this.branch, ['--rebase']);
    } catch {
      // offline is fine — work with local copy
    }
    return git;
  }

  private messagesDir() {
    return join(this.localPath, 'messages');
  }

  async push(msg: SynapseMessage): Promise<SynapseMessage> {
    const git = await this.ensureRepo();
    const projectDir = join(this.messagesDir(), msg.project);
    await mkdir(projectDir, { recursive: true });

    const date = msg.timestamp.split('T')[0]!;
    const filePath = join(projectDir, `${date}-${msg.id}.json`);
    await writeFile(filePath, JSON.stringify(msg, null, 2), 'utf-8');

    await git.add(filePath);
    const status = await git.status();
    if (status.staged.length > 0) {
      await git.commit(`synapse: [${msg.role}] ${msg.title}`);
      try {
        await git.push();
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        if (detail.includes('Authentication') || detail.includes('Permission') || detail.includes('403') || detail.includes('401')) {
          throw new Error(
            `Git push failed — authentication error.\n` +
            `Error: ${detail}\n\n` +
            `The message was saved locally at ${this.localPath} but could not be pushed to remote.\n` +
            `Fix: check your git credentials for ${this.repo}`
          );
        }
        // other push errors (offline, etc.) are non-fatal
      }
    }
    return msg;
  }

  async pull(query?: MessageQuery): Promise<SynapseMessage[]> {
    await this.ensureRepo();
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

export function applyQuery(messages: SynapseMessage[], query?: MessageQuery): SynapseMessage[] {
  let filtered = messages;
  if (query?.since) filtered = filtered.filter((m) => m.timestamp >= query.since!);
  if (query?.role) filtered = filtered.filter((m) => m.role === query.role);
  if (query?.category) filtered = filtered.filter((m) => m.category === query.category);
  if (query?.project) filtered = filtered.filter((m) => m.project === query.project);
  if (query?.assignTo) {
    filtered = filtered.filter((m) => {
      const meta = m.metadata as Record<string, unknown> | undefined;
      return meta?.assignTo === query.assignTo;
    });
  }
  filtered.sort((a, b) => (b.timestamp > a.timestamp ? 1 : b.timestamp < a.timestamp ? -1 : 0));
  if (query?.limit && query.limit > 0) filtered = filtered.slice(0, query.limit);
  return filtered;
}
