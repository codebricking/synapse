import type { SynapseMessage, MessageMetadata } from '../types.js';

/**
 * Metadata encoded in an HTML comment at the start of each section.
 * Invisible when rendered, machine-parseable for round-trip fidelity.
 */
interface SectionMeta {
  id: string;
  timestamp: string;
  author: string;
  role: string;
  category: string;
  tags?: string[];
  relatedFiles?: string[];
  metadata?: MessageMetadata;
}

const META_PREFIX = '<!-- synapse:';
const META_SUFFIX = ' -->';

function encodeMeta(msg: SynapseMessage): string {
  const meta: SectionMeta = {
    id: msg.id,
    timestamp: msg.timestamp,
    author: msg.author,
    role: msg.role,
    category: msg.category,
  };
  if (msg.tags?.length) meta.tags = msg.tags;
  if (msg.relatedFiles?.length) meta.relatedFiles = msg.relatedFiles;
  if (msg.metadata) meta.metadata = msg.metadata;
  return `${META_PREFIX}${JSON.stringify(meta)}${META_SUFFIX}`;
}

function decodeMeta(line: string): SectionMeta | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith(META_PREFIX) || !trimmed.endsWith(META_SUFFIX)) return null;
  const json = trimmed.slice(META_PREFIX.length, -META_SUFFIX.length).trim();
  try {
    return JSON.parse(json) as SectionMeta;
  } catch {
    return null;
  }
}

/**
 * Convert a SynapseMessage into a Markdown section (### heading).
 */
export function messageToSection(msg: SynapseMessage): string {
  const lines: string[] = [];
  lines.push(`### ${msg.title}`);
  lines.push(encodeMeta(msg));
  lines.push('');
  lines.push(msg.content);
  return lines.join('\n');
}

/**
 * Build the YAML front matter for a project document.
 */
export function buildFrontMatter(project: string, target: string): string {
  return [
    '---',
    `project: ${project}`,
    `module: ${target}`,
    `updated: ${new Date().toISOString()}`,
    '---',
    '',
  ].join('\n');
}

interface ParsedSection {
  title: string;
  meta: SectionMeta;
  content: string;
  raw: string;
}

/**
 * Parse a Markdown document into sections.
 * Each section starts with a ### heading followed by a synapse metadata comment.
 */
export function parseSections(md: string): ParsedSection[] {
  const sections: ParsedSection[] = [];
  const lines = md.split('\n');

  let currentTitle: string | null = null;
  let currentMeta: SectionMeta | null = null;
  let currentLines: string[] = [];
  let currentRawLines: string[] = [];

  function flush() {
    if (currentTitle && currentMeta) {
      const content = currentLines.join('\n').trim();
      const raw = currentRawLines.join('\n');
      sections.push({ title: currentTitle, meta: currentMeta, content, raw });
    }
  }

  for (const line of lines) {
    if (line.startsWith('### ')) {
      flush();
      currentTitle = line.slice(4).trim();
      currentMeta = null;
      currentLines = [];
      currentRawLines = [line];
      continue;
    }

    if (currentTitle && !currentMeta) {
      const meta = decodeMeta(line);
      if (meta) {
        currentMeta = meta;
        currentRawLines.push(line);
        continue;
      }
    }

    if (currentTitle) {
      currentLines.push(line);
      currentRawLines.push(line);
    }
  }

  flush();
  return sections;
}

/**
 * Convert parsed sections back to SynapseMessage objects.
 */
export function sectionsToMessages(sections: ParsedSection[], project: string, target: string): SynapseMessage[] {
  return sections.map((s) => ({
    id: s.meta.id,
    timestamp: s.meta.timestamp,
    author: s.meta.author,
    role: s.meta.role,
    category: s.meta.category,
    title: s.title,
    content: s.content,
    tags: s.meta.tags,
    project,
    target,
    relatedFiles: s.meta.relatedFiles,
    ...(s.meta.metadata ? { metadata: s.meta.metadata } : {}),
  }));
}

/**
 * Upsert a message into an existing MD document.
 * - If a section with the same id exists → replace it (overwrite).
 * - If a section with the same title exists → replace it (overwrite by title).
 * - Otherwise → append a new section.
 *
 * Returns the updated document content.
 */
export function upsertSection(existingMd: string, msg: SynapseMessage): string {
  const sections = parseSections(existingMd);
  const newSection = messageToSection(msg);

  const idxById = sections.findIndex((s) => s.meta.id === msg.id);
  const idxByTitle = sections.findIndex((s) => s.title === msg.title);
  const replaceIdx = idxById >= 0 ? idxById : idxByTitle;

  if (replaceIdx >= 0) {
    sections[replaceIdx] = {
      title: msg.title,
      meta: { id: msg.id, timestamp: msg.timestamp, author: msg.author, role: msg.role, category: msg.category },
      content: msg.content,
      raw: newSection,
    };
  } else {
    sections.push({
      title: msg.title,
      meta: { id: msg.id, timestamp: msg.timestamp, author: msg.author, role: msg.role, category: msg.category },
      content: msg.content,
      raw: newSection,
    });
  }

  const frontMatter = extractFrontMatter(existingMd);
  const updatedFm = updateFrontMatterTimestamp(frontMatter);
  const body = sections.map((s) => s.raw).join('\n\n---\n\n');

  return `${updatedFm}\n${body}\n`;
}

/**
 * Extract front matter from a markdown document.
 */
function extractFrontMatter(md: string): string {
  if (!md.startsWith('---')) return '';
  const end = md.indexOf('---', 3);
  if (end < 0) return '';
  return md.slice(0, end + 3);
}

/**
 * Update the `updated:` field in front matter to now.
 */
function updateFrontMatterTimestamp(fm: string): string {
  if (!fm) return fm;
  return fm.replace(/updated:\s*.+/, `updated: ${new Date().toISOString()}`);
}

/**
 * Create a new MD document with front matter and a single section.
 */
export function createDocument(msg: SynapseMessage, target: string): string {
  const fm = buildFrontMatter(msg.project, target);
  const section = messageToSection(msg);
  return `${fm}\n${section}\n`;
}

/**
 * Derive the target filename from a message.
 */
export function resolveTarget(msg: SynapseMessage): string {
  if (msg.target) return msg.target;
  return msg.category || 'general';
}
