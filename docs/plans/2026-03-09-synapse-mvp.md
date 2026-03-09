# Synapse MVP Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build Synapse MVP — a CLI + HTTP tool that detects backend API changes from Git diffs using LLM, syncs via Git, and notifies via Feishu/Lark.

**Architecture:** CLI entry point (commander.js) dispatches commands: `analyze` detects API changes from git diff via LLM, `push/pull` syncs structured change files to a shared Git repo, `notify` sends Feishu card messages, `serve` starts an HTTP server (Hono). All API changes are stored as JSON files following the ApiChange schema.

**Tech Stack:** TypeScript, Node.js, commander.js (CLI), Hono (HTTP), simple-git (Git ops), OpenAI SDK (LLM), node-fetch (Feishu webhook)

---

### Task 1: Project Initialization

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `.gitignore`
- Create: `src/index.ts` (empty entry)

**Step 1: Initialize npm project**

```bash
cd /Users/mozat/Desktop/code/project/synapse
npm init -y
```

**Step 2: Install dependencies**

```bash
npm install commander hono @hono/node-server simple-git openai zod cosmiconfig yaml
npm install -D typescript @types/node tsx tsup
```

**Step 3: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "declaration": true,
    "resolveJsonModule": true,
    "forceConsistentCasingInFileNames": true
  },
  "include": ["src"],
  "exclude": ["node_modules", "dist"]
}
```

**Step 4: Create .gitignore**

```
node_modules/
dist/
.env
*.log
```

**Step 5: Add scripts to package.json**

```json
{
  "type": "module",
  "bin": { "synapse": "./dist/index.js" },
  "scripts": {
    "dev": "tsx src/index.ts",
    "build": "tsup src/index.ts --format esm --dts",
    "start": "node dist/index.js"
  }
}
```

**Step 6: Create directory structure**

```bash
mkdir -p src/{detector,sync,server,prompts}
```

---

### Task 2: Core Types & Configuration

**Files:**
- Create: `src/types.ts`
- Create: `src/config.ts`
- Create: `synapse.example.yaml`

**Step 1: Define ApiChange types in src/types.ts**

Core interfaces: FieldChange, EndpointChange, ApiChange, SynapseConfig.

**Step 2: Create config loader in src/config.ts**

Use cosmiconfig to load `synapse.yaml` or `.synapserc`. Define defaults. Validate with zod.

**Step 3: Create synapse.example.yaml**

Example config with project name, LLM provider settings, Git sync repo, Feishu webhook URL.

---

### Task 3: Git Diff Extractor

**Files:**
- Create: `src/detector/git-diff.ts`

**Step 1: Implement getDiff function**

Use simple-git to get diff between commits or HEAD~1..HEAD. Return raw diff string.

**Step 2: Implement getChangedFiles function**

Return list of changed files with their status (added/modified/deleted).

---

### Task 4: Pre-filter

**Files:**
- Create: `src/detector/pre-filter.ts`

**Step 1: Implement file extension filter**

Keep only source files (.java, .py, .go, .ts, .js, .kt, .swift, .rs, .rb, .php, etc). Exclude tests, docs, configs.

**Step 2: Implement keyword filter**

Scan diff content for API-related keywords: route, endpoint, controller, handler, @GetMapping, @PostMapping, @app.get, router.get, etc.

---

### Task 5: LLM Analyzer

**Files:**
- Create: `src/detector/llm-analyzer.ts`
- Create: `src/prompts/detect.ts`
- Create: `src/prompts/extract.ts`

**Step 1: Create detection prompt template**

System prompt + user prompt that takes a git diff and returns structured ApiChange JSON.

**Step 2: Implement LLM call wrapper**

Support OpenAI-compatible API (works with OpenAI, Claude via proxy, Ollama). Use structured output (JSON mode).

**Step 3: Implement analyzeChanges function**

Takes git diff string → pre-filter → LLM analyze → validate output → return ApiChange[].

---

### Task 6: Git Sync

**Files:**
- Create: `src/sync/git.ts`

**Step 1: Implement pushChanges**

Clone/open shared repo → write ApiChange JSON to `changes/{date}-{id}.json` → commit → push.

**Step 2: Implement pullChanges**

Pull latest from shared repo → read new change files → return ApiChange[].

**Step 3: Implement checkUnadapted**

Compare local adapted list vs all changes → return unadapted changes.

---

### Task 7: Feishu/Lark Notification

**Files:**
- Create: `src/sync/lark.ts`

**Step 1: Build card message**

Convert ApiChange to Feishu interactive card JSON (with breaking change warning, field details, platform impact).

**Step 2: Implement sendNotification**

POST to Feishu webhook URL with card message. Handle errors.

---

### Task 8: CLI Commands

**Files:**
- Create: `src/cli/analyze.ts`
- Create: `src/cli/push.ts`
- Create: `src/cli/pull.ts`
- Create: `src/cli/check.ts`
- Create: `src/cli/notify.ts`
- Create: `src/cli/serve.ts`
- Modify: `src/index.ts`

**Step 1: Implement each CLI command**

Wire up commander.js commands to core functions:
- `synapse analyze` → git diff → pre-filter → LLM → output changes
- `synapse push` → push changes to shared Git repo
- `synapse pull` → pull changes from shared Git repo
- `synapse check` → check unadapted changes
- `synapse notify` → send Feishu notification
- `synapse serve` → start HTTP server

**Step 2: Wire up index.ts**

Import all commands, register with commander, add version/help.

---

### Task 9: HTTP Server

**Files:**
- Create: `src/server/index.ts`

**Step 1: Create Hono app with routes**

- `POST /api/analyze` — accept diff text, return ApiChange[]
- `POST /api/sync/lark` — accept ApiChange, send to Feishu
- `GET /api/changes` — list changes from local store
- `GET /api/changes/:id` — get single change detail

---

### Task 10: Cursor Skill

**Files:**
- Create: `SKILL.md`

**Step 1: Write Skill for backend developers**

When AI detects it modified API-related code, call `synapse analyze` and offer to push/notify.

**Step 2: Write Skill for client developers**

When starting work, call `synapse check` to see if there are unadapted API changes.
