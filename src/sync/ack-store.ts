import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';

/**
 * Tracks which messages have been processed by this project's AI.
 * Stored per-project at ~/.synapse/ack/{project}.json
 *
 * This prevents AI from re-processing the same message and wasting tokens.
 */

interface AckRecord {
  id: string;
  ackedAt: string;
}

interface AckData {
  project: string;
  acked: AckRecord[];
}

function ackDir(): string {
  return join(homedir(), '.synapse', 'ack');
}

function ackFilePath(project: string): string {
  const safe = project.replace(/[^a-zA-Z0-9._-]/g, '_');
  return join(ackDir(), `${safe}.json`);
}

async function loadAckData(project: string): Promise<AckData> {
  const file = ackFilePath(project);
  if (!existsSync(file)) return { project, acked: [] };
  try {
    const raw = await readFile(file, 'utf-8');
    return JSON.parse(raw) as AckData;
  } catch {
    return { project, acked: [] };
  }
}

async function saveAckData(data: AckData): Promise<void> {
  const dir = ackDir();
  await mkdir(dir, { recursive: true });
  await writeFile(ackFilePath(data.project), JSON.stringify(data, null, 2), 'utf-8');
}

export async function getAckedIds(project: string): Promise<Set<string>> {
  const data = await loadAckData(project);
  return new Set(data.acked.map((r) => r.id));
}

export async function ackMessage(project: string, messageId: string): Promise<void> {
  const data = await loadAckData(project);
  if (data.acked.some((r) => r.id === messageId)) return;
  data.acked.push({ id: messageId, ackedAt: new Date().toISOString() });
  await saveAckData(data);
}

export async function ackMessages(project: string, messageIds: string[]): Promise<number> {
  const data = await loadAckData(project);
  const existing = new Set(data.acked.map((r) => r.id));
  let count = 0;
  for (const id of messageIds) {
    if (existing.has(id)) continue;
    data.acked.push({ id, ackedAt: new Date().toISOString() });
    count++;
  }
  if (count > 0) await saveAckData(data);
  return count;
}

export async function resetAck(project: string): Promise<void> {
  await saveAckData({ project, acked: [] });
}
