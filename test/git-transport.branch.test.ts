import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { GitTransport } from '../src/sync/git-transport.js';
import type { SynapseConfig, SynapseMessage } from '../src/types.js';

const execFileAsync = promisify(execFile);

function repoCacheName(repo: string): string {
  const match = repo.match(/\/([^/]+?)(?:\.git)?$/);
  return match ? match[1]!.replace(/[^a-zA-Z0-9._-]/g, '_') : 'repo';
}

async function createRemoteWithMainAndApi(remotePath: string) {
  await mkdir(remotePath, { recursive: true });
  await runGit(['init', '--bare', remotePath]);
  await runGit(['symbolic-ref', 'HEAD', 'refs/heads/main'], remotePath);

  const seedPath = await mkdtemp(join(tmpdir(), 'synapse-seed-'));
  await runGit(['init'], seedPath);
  await runGit(['config', 'user.name', 'Synapse Test'], seedPath);
  await runGit(['config', 'user.email', 'synapse-test@example.com'], seedPath);
  await writeFile(join(seedPath, 'README.md'), '# seed\n', 'utf8');
  await runGit(['add', 'README.md'], seedPath);
  await runGit(['commit', '-m', 'seed'], seedPath);
  await runGit(['branch', '-M', 'main'], seedPath);
  await runGit(['remote', 'add', 'origin', remotePath], seedPath);
  await runGit(['push', '-u', 'origin', 'main'], seedPath);
  await runGit(['checkout', '-b', 'api'], seedPath);
  await runGit(['push', '-u', 'origin', 'api'], seedPath);

  const initialCommit = await revParse(seedPath, 'HEAD');
  return { initialCommit };
}

async function lsRemoteBranch(remotePath: string, branch: string): Promise<string> {
  const { stdout } = await execFileAsync('git', ['ls-remote', remotePath, `refs/heads/${branch}`]);
  return stdout.trim().split('\t')[0] ?? '';
}

async function runGit(args: string[], cwd?: string) {
  await execFileAsync('git', args, cwd ? { cwd } : undefined);
}

async function revParse(cwd: string, ref: string): Promise<string> {
  const { stdout } = await execFileAsync('git', ['rev-parse', ref], { cwd });
  return stdout.trim();
}

test('push uses configured git branch even when cached repo is on another branch', async () => {
  const tempRoot = await mkdtemp(join(tmpdir(), 'synapse-branch-'));
  const remotePath = join(tempRoot, 'remote.git');
  const homePath = join(tempRoot, 'home');
  const { initialCommit } = await createRemoteWithMainAndApi(remotePath);

  process.env.HOME = homePath;

  const cachePath = join(homePath, '.synapse', 'repos', repoCacheName(remotePath));
  await mkdir(dirname(cachePath), { recursive: true });
  await runGit(['clone', remotePath, cachePath]);

  const config: SynapseConfig = {
    project: { name: 'server-live' },
    sync: {
      git: {
        repo: remotePath,
        branch: 'api',
      },
    },
  };

  const transport = new GitTransport(config);
  const message: SynapseMessage = {
    id: 'msg-test-branch',
    timestamp: '2026-03-19T00:00:00.000Z',
    author: 'tester',
    role: 'backend',
    category: 'status',
    title: 'branch test',
    content: 'should land on api branch',
    project: 'server-live',
    target: 'status',
  };

  await transport.push(message);

  const remoteMain = await lsRemoteBranch(remotePath, 'main');
  const remoteApi = await lsRemoteBranch(remotePath, 'api');

  assert.equal(remoteMain, initialCommit, 'main branch should stay unchanged');
  assert.notEqual(remoteApi, initialCommit, 'api branch should receive the new commit');

  const verifyPath = join(tempRoot, 'verify-api');
  await runGit(['clone', '-b', 'api', remotePath, verifyPath]);
  const { stdout: pushedContent } = await execFileAsync('git', ['show', 'HEAD:projects/server-live/status.md'], { cwd: verifyPath });
  assert.match(pushedContent, /branch test/);
});
