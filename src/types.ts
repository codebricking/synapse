// ── Structured metadata per category ─────────────────
// The tool does NOT validate these — it's a dumb pipe.
// The schema here guides the sending/receiving AI to
// produce and consume actionable structured data.

export interface BugMetadata {
  type: 'bug';
  severity: 'critical' | 'high' | 'medium' | 'low';
  assignTo: string;
  endpoint?: string;
  steps?: string[];
  expected?: string;
  actual?: string;
}

export interface ApiChangeMetadata {
  type: 'api_change';
  breaking: boolean;
  endpoints: Array<{ method: string; path: string }>;
  migration?: string;
  platforms?: string[];
}

export interface RequirementMetadata {
  type: 'requirement';
  priority: 'critical' | 'high' | 'medium' | 'low';
  platforms?: string[];
  acceptanceCriteria?: string[];
}

export type MessageMetadata =
  | BugMetadata
  | ApiChangeMetadata
  | RequirementMetadata
  | Record<string, unknown>;

// ── Core message ─────────────────────────────────────

export interface SynapseMessage {
  id: string;
  timestamp: string;
  author: string;
  role: string;
  category: string;
  title: string;
  content: string;
  tags?: string[];
  project: string;
  /** Target MD file name (without .md). e.g. "api-user", "decisions". Defaults to category. */
  target?: string;
  relatedFiles?: string[];
  metadata?: MessageMetadata;
}

export interface MessageQuery {
  since?: string;
  role?: string;
  category?: string;
  project?: string;
  assignTo?: string;
  limit?: number;
  unread?: boolean;
}

// ── Config ───────────────────────────────────────────

export interface SynapseConfig {
  project: {
    name: string;
  };
  sync: {
    primary?: 'git' | 'local' | 'http';
    git?: {
      repo: string;
      branch?: string;
    };
    larkWebhook?: {
      url: string;
    };
    local?: {
      dir?: string;
    };
    http?: {
      url: string;
      token?: string;
    };
  };
}

export interface SynapseTransport {
  push(msg: SynapseMessage): Promise<SynapseMessage>;
  pull(query?: MessageQuery): Promise<SynapseMessage[]>;
  get(id: string): Promise<SynapseMessage | null>;
}
