---
name: synapse-message-sync
description: Use after making code changes that other team roles need to know about, or at the start of a work session to check for updates. Synapse is a dumb pipe — YOU decide what to sync, when, and what metadata to attach. Transport (Git and/or Feishu) is config-driven.
---

# Synapse — AI-to-AI Message Sync

Synapse is a **pure message tool**. No AI inside. You decide what to sync and when.
Transport is determined by `synapse.yaml` — can be Git, Feishu, or both.

- **Push** → broadcasts to **all** configured transports
- **Pull** → reads from the **primary** transport only (default priority: git > lark)

---

## Quick Reference

```bash
# Push
synapse msg send "<title>" --role <role> --category <cat> --content "<body>" --metadata '<json>'

# Pull
synapse msg list --json
synapse msg list --category bug --assign-to frontend --limit 10
synapse msg list --category api_change --limit 10

# HTTP
POST http://localhost:3000/api/messages    {title, content, role, category, metadata}
GET  http://localhost:3000/api/messages    ?category=bug&assignTo=frontend&limit=10
```

---

## Structured Metadata

Each category has a recommended metadata schema. You fill it in — Synapse just stores and forwards.

### Bug Report (`category: "bug"`)

When you find a bug that another role needs to fix:

```bash
synapse msg send "用户列表接口 500 错误" \
  --role frontend --category bug \
  --content "调用 GET /api/v1/users?page=2 时返回 500，page=1 正常。请求头包含正确的 Authorization token。" \
  --metadata '{"type":"bug","severity":"high","assignTo":"backend","endpoint":"GET /api/v1/users","expected":"返回第二页用户列表","actual":"HTTP 500 Internal Server Error"}'
```

HTTP:

```json
{
  "title": "用户列表接口 500 错误",
  "content": "调用 GET /api/v1/users?page=2 时返回 500...",
  "role": "frontend",
  "category": "bug",
  "metadata": {
    "type": "bug",
    "severity": "high",
    "assignTo": "backend",
    "endpoint": "GET /api/v1/users",
    "expected": "返回第二页用户列表",
    "actual": "HTTP 500 Internal Server Error"
  }
}
```

### API Change (`category: "api_change"`)

When you modified API endpoints:

```json
{
  "title": "用户注册接口新增 phone 字段",
  "content": "POST /api/v1/users 新增 phone（string, E.164, 必填）...",
  "role": "backend",
  "category": "api_change",
  "metadata": {
    "type": "api_change",
    "breaking": true,
    "endpoints": [{"method": "POST", "path": "/api/v1/users"}],
    "migration": "客户端注册表单需新增手机号输入框",
    "platforms": ["android", "ios", "web"]
  }
}
```

### Requirement (`category: "requirement"`)

When PM defines a new requirement:

```json
{
  "title": "支持用户头像上传",
  "content": "用户可以在个人设置页上传头像，支持 jpg/png，最大 5MB...",
  "role": "pm",
  "category": "requirement",
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
3. Is it an API/model change? → `category: "api_change"`, fill `metadata.endpoints`
4. Is it a decision/requirement? → `category: "decision"` or `"requirement"`
5. Push, tell the user "已同步"

### At session start — what should I pull?

Pick the queries that match your role:

```bash
# I'm frontend — show me bugs assigned to me
synapse msg list --category bug --assign-to frontend --json

# I'm frontend — show me recent API changes
synapse msg list --category api_change --json

# I'm backend — show me bugs assigned to me
synapse msg list --category bug --assign-to backend --json

# Show me everything recent
synapse msg list --json
```

After pulling, read `metadata` to decide what to do:
- `bug` with `assignTo` matching your role → fix the bug
- `api_change` with `breaking: true` → adapt your code
- `requirement` → implement the feature

### After fixing a bug or adapting to a change:

Push a follow-up message:

```bash
synapse msg send "已修复: 用户列表分页 500 错误" \
  --role backend --category status \
  --content "原因是 offset 计算溢出，已修复并添加测试。" \
  --metadata '{"type":"status","replyTo":"msg-20260309-abc123"}'
```

---

## Metadata Schemas

| Category | `metadata.type` | Key Fields |
|----------|-----------------|------------|
| bug | `"bug"` | `severity`, `assignTo`, `endpoint`, `expected`, `actual`, `steps` |
| api_change | `"api_change"` | `breaking`, `endpoints[]`, `migration`, `platforms[]` |
| requirement | `"requirement"` | `priority`, `platforms[]`, `acceptanceCriteria[]` |
| * | any | `metadata` is free-form — add whatever is useful |
