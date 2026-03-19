import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import simpleGit from 'simple-git';
import type { SynapseMessage, SynapseConfig, MessageQuery, SynapseTransport } from '../types.js';
import { resolveTarget, createDocument, upsertSection, parseSections, sectionsToMessages } from './md-parser.js';

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
      await git.fetch('origin', this.branch);
      const localBranches = await git.branchLocal();
      if (localBranches.current !== this.branch) {
        if (localBranches.all.includes(this.branch)) {
          await git.checkout(this.branch);
        } else {
          await git.raw(['checkout', '-B', this.branch, `origin/${this.branch}`]);
        }
      }
      await git.pull('origin', this.branch, ['--rebase']);
    } catch {
      // offline — work with local copy
    }
    return git;
  }

  private projectsDir() {
    return join(this.localPath, 'projects');
  }

  private mdFilePath(project: string, target: string): string {
    return join(this.projectsDir(), project, `${target}.md`);
  }

  async push(msg: SynapseMessage): Promise<SynapseMessage> {
    const git = await this.ensureRepo();
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

    await git.add(filePath);
    const status = await git.status();
    if (status.staged.length > 0) {
      await git.commit(`synapse: [${msg.role}] ${msg.title}`);
      try {
        await git.push('origin', this.branch);
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
      }
    }
    return msg;
  }

  async pull(query?: MessageQuery): Promise<SynapseMessage[]> {
    await this.ensureRepo();
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
        } catch { /* skip unreadable files */ }
      }
    }

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
