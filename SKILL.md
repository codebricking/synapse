---
name: synapse-message-sync
description: Use after making code changes that other team roles need to know about, or at the start of a work session to check for updates. Synapse is a dumb pipe — YOU decide what to sync, when, and what metadata to attach. Transport (Git, Local, HTTP, or Webhook) is config-driven. Messages are stored as Markdown files with overwrite semantics; Git tracks all change history.
---

# Synapse — AI-to-AI Message Sync

Synapse is a **pure message tool**. No AI inside. You decide what to sync and when.
Transport is determined by `synapse.yaml` — can be Git, Local, HTTP, Webhook, or any combination.

- **Push** → broadcasts to **all** configured transports
- **Pull** → reads from the **primary** transport only (default priority: git > local > http > larkWebhook)

### Storage model

Messages are stored as **Markdown files** in a shared Git repo:

```
projects/{project}/{target}.md
```

- Each push **upserts** a section (matched by id or title) — same API endpoint updates overwrite in place.
- The file always reflects the **current state**. Git history tracks all changes.
- `--target` specifies which MD file to write (e.g. `api-user`, `decisions`). Defaults to `category`.
- Use `git diff` / `git log -p` to see what changed between versions.

### Transport quick pick

| User role | Recommended transport | Config |
|-----------|----------------------|--------|
| Developer | `git` (+ optional `larkWebhook`) | `sync.git.repo` |
| PM / Design | `http` (connect to team server) | `sync.http.url` |
| Server | `local` | `sync.local.dir` |
| Notifications only | `larkWebhook` | `sync.larkWebhook.url` |

---

## First-Time Setup (MUST DO before any push/pull)

**When you first use Synapse or encounter push/pull errors, run through this checklist:**

### 1. Install Synapse

```bash
npm install -g synapse-sync
# or use without installing:
npx synapse-sync msg list --json
```

### 2. Check synapse.yaml

Look for `synapse.yaml` in the project root. If it doesn't exist, ask the user which transport to use and create it.

### 3. Git transport — CRITICAL setup step

If `synapse.yaml` has `sync.git.repo` configured, Synapse stores messages as Markdown files in a **shared Git repository** (NOT the project repo). This shared repo must be accessible:

```bash
# Verify: can you clone the synapse-hub repo?
git clone <the repo URL from synapse.yaml sync.git.repo> /tmp/synapse-test && rm -rf /tmp/synapse-test
```

**If the clone fails**, fix it BEFORE calling any synapse command:

| Problem | Solution |
|---------|----------|
| Repo doesn't exist | Ask the team who created the repo, or create it: `gh repo create org/synapse-hub --private` |
| Auth failed (HTTPS) | Run `git config --global credential.helper store` and do a manual clone to cache credentials |
| Auth failed (SSH) | Ensure SSH key is added: `ssh -T git@github.com` should succeed |
| Network/firewall | Check proxy settings or switch to `sync.local` + `sync.http` transport instead |

**Synapse auto-clones the repo** to `~/.synapse/repos/<repo-name>/` on first use. But if git credentials are not configured, the clone fails silently and push/pull will error out.

**Quick fix if stuck:** Manually clone the repo first:

```bash
mkdir -p ~/.synapse/repos
git clone <repo-url> ~/.synapse/repos/<repo-name>
# Then synapse commands will work
```

### 4. Verify setup

```bash
# This should succeed without errors:
synapse msg list --json
```

If you see `No transport configured` → check synapse.yaml exists.
If you see git clone/push errors → fix git access (step 3 above).

---

## Quick Reference

```bash
# Push (--target specifies which MD file to update, defaults to category)
synapse msg send "<title>" --role <role> --category <cat> --target <module> --content "<body>" --metadata '<json>'

# Pull
synapse msg list --json
synapse msg list --category bug --assign-to frontend --limit 10
synapse msg list --category api_change --limit 10

# Unread only (avoid re-processing, save tokens)
synapse msg list --unread --ack --json

# HTTP API
POST http://localhost:3000/api/messages    {title, content, role, category, target, metadata}
GET  http://localhost:3000/api/messages    ?category=bug&assignTo=frontend&limit=10
```

### Target naming convention

| category | recommended `--target` | example file |
|----------|----------------------|--------------|
| api_change | `api-{module}` | `projects/backend/api-user.md` |
| bug | `bug` | `projects/frontend/bug.md` |
| requirement | `requirement` | `projects/pm/requirement.md` |
| decision | `decisions` | `projects/backend/decisions.md` |
| status | `status` | `projects/backend/status.md` |

---

## Structured Metadata

Each category has a recommended metadata schema. You fill it in — Synapse just stores and forwards.

### Bug Report (`category: "bug"`)

When you find a bug that another role needs to fix:

```bash
synapse msg send "用户列表接口 500 错误" \
  --role frontend --category bug --target bug \
  --content "调用 GET /api/v1/users?page=2 时返回 500..." \
  --metadata '{"type":"bug","severity":"high","assignTo":"backend","endpoint":"GET /api/v1/users","expected":"返回第二页用户列表","actual":"HTTP 500"}'
```

### API Change (`category: "api_change"`)

When you modified API endpoints:

```bash
synapse msg send "用户注册接口新增 phone 字段" \
  --role backend --category api_change --target api-user \
  --content "POST /api/v1/users 新增 phone（string, E.164, 必填）..." \
  --metadata '{"type":"api_change","breaking":true,"endpoints":[{"method":"POST","path":"/api/v1/users"}],"migration":"客户端注册表单需新增手机号输入框"}'
```

### Requirement (`category: "requirement"`)

When PM defines a new requirement:

```json
{
  "title": "支持用户头像上传",
  "content": "用户可以在个人设置页上传头像，支持 jpg/png，最大 5MB...",
  "role": "pm",
  "category": "requirement",
  "target": "requirement",
  "metadata": {
    "type": "requirement",
    "priority": "high",
    "platforms": ["android", "ios", "web"],
    "acceptanceCriteria": [
      "支持 jpg/png 格式",
      "文件大小限制 5MB",
      "上传后立即显示新头像",
      "上传失败显示错误提示"
    ]
  }
}
```

---

## Decision Flow

### After code edits — should I push?

1. Does this change affect other roles? → If no, stop
2. Is it a bug in someone else's code? → `category: "bug"`, fill `metadata.assignTo`
3. Is it an API/model change? → `category: "api_change"`, `--target api-{module}`
4. Is it a decision/requirement? → `category: "decision"` or `"requirement"`
5. Push, tell the user "已同步"

### At session start — what should I pull?

**IMPORTANT:** Always use `--unread` to avoid re-processing messages and wasting tokens.
Use `--ack` to auto-mark messages as processed after pulling.

```bash
# I'm frontend — show me NEW bugs assigned to me (skip already processed)
synapse msg list --unread --ack --category bug --assign-to frontend --json

# I'm frontend — show me NEW API changes
synapse msg list --unread --ack --category api_change --json

# I'm backend — show me NEW bugs assigned to me
synapse msg list --unread --ack --category bug --assign-to backend --json

# Show me everything unread
synapse msg list --unread --ack --json
```

After pulling, read `metadata` to decide what to do:
- `bug` with `assignTo` matching your role → fix the bug
- `api_change` with `breaking: true` → adapt your code
- `requirement` → implement the feature

### After fixing a bug or adapting to a change:

Push a follow-up message:

```bash
synapse msg send "已修复: 用户列表分页 500 错误" \
  --role backend --category status --target status \
  --content "原因是 offset 计算溢出，已修复并添加测试。"
```

### Manual ack (when you process messages without --ack flag):

```bash
synapse msg ack msg-20260310-abc123 msg-20260310-def456
```

---

## Metadata Schemas

| Category | `metadata.type` | Key Fields |
|----------|-----------------|------------|
| bug | `"bug"` | `severity`, `assignTo`, `endpoint`, `expected`, `actual`, `steps` |
| api_change | `"api_change"` | `breaking`, `endpoints[]`, `migration`, `platforms[]` |
| requirement | `"requirement"` | `priority`, `platforms[]`, `acceptanceCriteria[]` |
| * | any | `metadata` is free-form — add whatever is useful |
