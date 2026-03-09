import path from 'node:path';
import { cosmiconfig } from 'cosmiconfig';
import { z } from 'zod';
import type { SynapseConfig } from './types.js';

const SynapseConfigSchema = z.object({
  project: z.object({
    name: z.string(),
  }),
  sync: z
    .object({
      primary: z.enum(['git', 'lark']).optional(),
      git: z
        .object({
          repo: z.string(),
          branch: z.string().optional(),
        })
        .optional(),
      lark: z
        .object({
          appId: z.string(),
          appSecret: z.string(),
          chatId: z.string(),
          webhookUrl: z.string().optional(),
        })
        .optional(),
    })
    .optional()
    .default({}),
});

let _configPath: string | null = null;

function applyDefaults(config: Partial<SynapseConfig>): SynapseConfig {
  return {
    project: {
      name: config.project?.name ?? path.basename(process.cwd()),
    },
    sync: {
      primary: config.sync?.primary,
      git: config.sync?.git
        ? { repo: config.sync.git.repo, branch: config.sync.git.branch ?? 'main' }
        : undefined,
      lark: config.sync?.lark,
    },
  };
}

export async function loadConfigFromPath(configPath: string): Promise<SynapseConfig> {
  const explorer = cosmiconfig('synapse');
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

  const explorer = cosmiconfig('synapse');
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
