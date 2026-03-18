import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { readFile } from 'fs/promises';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { loadConfig } from '../config.js';
import { pushMessage, pullMessages, getMessage, getTransportNames, ackMessageById, ackMessagesByIds } from '../sync/messages.js';
import type { SynapseConfig, MessageQuery } from '../types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

let cachedVersion: string | null = null;
async function getVersion(): Promise<string> {
  if (!cachedVersion) {
    const pkg = JSON.parse(await readFile(join(__dirname, '..', '..', 'package.json'), 'utf-8'));
    cachedVersion = pkg.version;
  }
  return cachedVersion!;
}

let cachedConfig: SynapseConfig | null = null;

async function getConfig(): Promise<SynapseConfig> {
  if (!cachedConfig) cachedConfig = await loadConfig();
  return cachedConfig;
}

function createApp(): Hono {
  const app = new Hono();

  app.get('/api/health', async (c) => {
    const config = await getConfig();
    const names = getTransportNames(config);
    return c.json({
      status: 'ok',
      version: await getVersion(),
      transports: names,
      primary: names[0] ?? 'none',
      project: config.project.name,
      timestamp: new Date().toISOString(),
    });
  });

  app.post('/api/messages', async (c) => {
    const body = await c.req.json();
    const config = await getConfig();

    if (!body.title || !body.content || !body.role) {
      return c.json({ error: 'title, content, role are required' }, 400);
    }

    const { message, results } = await pushMessage(
      {
        id: body.id,
        timestamp: body.timestamp,
        author: body.author ?? 'unknown',
        role: body.role,
        category: body.category ?? 'note',
        title: body.title,
        content: body.content,
        tags: body.tags,
        project: body.project ?? config.project.name,
        target: body.target,
        relatedFiles: body.relatedFiles,
        metadata: body.metadata,
      },
      config
    );

    return c.json({ success: results.every((r) => r.ok), message, deliveredTo: results });
  });

  app.get('/api/messages', async (c) => {
    const config = await getConfig();
    const names = getTransportNames(config);
    const query: MessageQuery = {
      since: c.req.query('since'),
      role: c.req.query('role'),
      category: c.req.query('category'),
      project: c.req.query('project'),
      assignTo: c.req.query('assignTo'),
      limit: c.req.query('limit') ? parseInt(c.req.query('limit')!, 10) : undefined,
      unread: c.req.query('unread') === 'true',
    };
    const messages = await pullMessages(config, query);
    return c.json({ messages, total: messages.length, pulledFrom: names[0] ?? 'none' });
  });

  app.get('/api/messages/:id', async (c) => {
    const config = await getConfig();
    const msg = await getMessage(c.req.param('id'), config);
    if (!msg) return c.json({ error: 'not found' }, 404);
    return c.json(msg);
  });

  app.post('/api/messages/:id/ack', async (c) => {
    const config = await getConfig();
    const id = c.req.param('id');
    await ackMessageById(id, config);
    return c.json({ success: true, id });
  });

  app.post('/api/messages/ack', async (c) => {
    const config = await getConfig();
    const body = await c.req.json() as { ids?: string[] };
    if (!body.ids?.length) return c.json({ error: 'ids[] is required' }, 400);
    const count = await ackMessagesByIds(body.ids, config);
    return c.json({ success: true, acked: count, total: body.ids.length });
  });

  return app;
}

export async function startServer(options: { host: string; port: number }): Promise<void> {
  const config = await loadConfig();
  const names = getTransportNames(config);

  const app = createApp();

  console.log(`Synapse server listening on http://${options.host}:${options.port}`);
  console.log(`Transports: ${names.join(', ') || 'none'} (primary: ${names[0] ?? 'none'})`);
  console.log(`  Push → all: [${names.join(', ')}]`);
  console.log(`  Pull → primary: ${names[0] ?? 'none'}`);
  console.log('');
  console.log('Endpoints:');
  console.log('  GET  /api/health             - transport info');
  console.log('  POST /api/messages           - push to all transports');
  console.log('  GET  /api/messages           - pull (?category=&assignTo=&unread=true)');
  console.log('  GET  /api/messages/:id       - get by id');
  console.log('  POST /api/messages/:id/ack   - mark one message as processed');
  console.log('  POST /api/messages/ack       - batch ack {ids: [...]}');

  serve({ fetch: app.fetch, hostname: options.host, port: options.port });
}

export { createApp };
