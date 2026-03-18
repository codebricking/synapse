import path from 'node:path';
import { cosmiconfig } from 'cosmiconfig';
import { z } from 'zod';
import type { SynapseConfig } from './types.js';

const SEARCH_PLACES = [
  'package.json',
  'synapse.yaml',
  'synapse.yml',
  '.synapserc',
  '.synapserc.json',
  '.synapserc.yaml',
  '.synapserc.yml',
  '.synapserc.js',
  '.synapserc.ts',
  '.synapserc.cjs',
  'synapse.config.js',
  'synapse.config.ts',
  'synapse.config.cjs',
];

const SynapseConfigSchema = z.object({
  project: z.object({
    name: z.string(),
  }),
  sync: z
    .object({
      primary: z.enum(['git', 'local', 'http']).optional(),
      git: z
        .object({
          repo: z.string(),
          branch: z.string().optional(),
        })
        .optional(),
      larkWebhook: z
        .object({
          url: z.string(),
        })
        .optional(),
      local: z
        .object({
          dir: z.string().optional(),
        })
        .optional(),
      http: z
        .object({
          url: z.string(),
          token: z.string().optional(),
        })
        .optional(),
    })
    .optional()
    .default({}),
});

let _configPath: string | null = null;

function hasAnyTransport(sync?: Partial<SynapseConfig['sync']>): boolean {
  return !!(sync?.git || sync?.larkWebhook || sync?.local || sync?.http);
}

function applyDefaults(config: Partial<SynapseConfig>): SynapseConfig {
  const useLocalFallback = !hasAnyTransport(config.sync);
  return {
    project: {
      name: config.project?.name ?? path.basename(process.cwd()),
    },
    sync: {
      primary: config.sync?.primary,
      git: config.sync?.git
        ? { repo: config.sync.git.repo, branch: config.sync.git.branch ?? 'main' }
        : undefined,
      larkWebhook: config.sync?.larkWebhook,
      local: config.sync?.local ?? (useLocalFallback ? {} : undefined),
      http: config.sync?.http,
    },
  };
}

export async function loadConfigFromPath(configPath: string): Promise<SynapseConfig> {
  const explorer = cosmiconfig('synapse', { searchPlaces: SEARCH_PLACES });
  const result = await explorer.load(configPath);
  if (!result?.config) {
    throw new Error(`Config file not found or empty: ${configPath}`);
  }
  _configPath = result.filepath ?? configPath;
  const parsed = SynapseConfigSchema.safeParse(result.config);
  if (parsed.success) return applyDefaults(parsed.data);
  throw new Error(`Invalid synapse config at ${result.filepath}: ${parsed.error.message}`);
}

export async function loadConfig(configPath?: string): Promise<SynapseConfig> {
  if (configPath) return loadConfigFromPath(configPath);

  const explorer = cosmiconfig('synapse', { searchPlaces: SEARCH_PLACES });
  const result = await explorer.search();

  if (result?.config) {
    _configPath = result.filepath;
    const parsed = SynapseConfigSchema.safeParse(result.config);
    if (parsed.success) return applyDefaults(parsed.data);
    throw new Error(`Invalid synapse config at ${result.filepath}: ${parsed.error.message}`);
  }

  _configPath = null;
  return applyDefaults({});
}

export function getConfigPath(): string | null {
  return _configPath;
}
