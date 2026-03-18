# Synapse

AI-to-AI 消息同步工具。Synapse 本身不包含 AI，它只做存储和转发。

### 要解决的问题

现在的团队协作中，后端改了接口、产品改了需求、测试发现了 bug，都依赖**人**去通知相关方，再由相关方**手动**修改代码。即使每个人都在用 AI 写代码，这些 AI 之间也是互相隔离的——后端的 Cursor 不知道客户端的 Claude Code 在干什么，产品的 AI 不知道接口已经改了。

**信息在人与人之间传递，AI 只是被动的执行者。**

Synapse 改变这个流程：让 AI 成为信息的发布者和消费者。后端 AI 改完接口后主动推送变更，客户端 AI 自动拉取并适配代码，产品 AI 发布需求后各端 AI 直接开始实现。人只需要 review。

```
                    传统流程
后端开发 ──人工通知──▶ 客户端开发 ──人工改代码──▶ 提交

                   Synapse 流程
后端 AI ──push──▶ Synapse ──pull──▶ 客户端 AI ──自动适配──▶ 等人 review
```

### 架构

```
后端 AI ──push──▶ Synapse ◀──pull── 客户端 AI
产品 AI ──push──▶         ◀──pull── 测试 AI
```

传输层由配置决定，可以配一个或多个渠道。**推送广播到所有渠道，拉取只从主渠道读。**

支持 4 种传输层，按需选配：

| 传输层 | 读写 | 需要审批 | 适合谁 |
|--------|------|---------|--------|
| **Git** | 读写 | 不需要 | 开发者 |
| **Local** | 读写 | 不需要 | 服务端本地存储 |
| **HTTP** | 读写 | 不需要 | PM/设计（连团队 synapse 服务） |
| **Lark Webhook** | 只写 | 不需要 | 飞书通知（1 分钟搞定） |

### 存储格式

消息以 **Markdown 文件**存储，每个模块对应一个 MD 文件。Git 版本历史自动追踪所有变更。

```
synapse-hub.git/
└── projects/
    └── ecommerce-backend/
        ├── api-user.md       ← 用户相关接口（覆盖式更新）
        ├── api-order.md      ← 订单相关接口
        └── decisions.md      ← 架构决策记录
```

每次 push 时，消息会**覆盖**目标文件中同 ID 或同标题的段落。文件始终反映当前最新状态，历史变更通过 `git log / git diff` 查看。

---

## 安装

按你的角色选择安装方式：

### 方式 1：npm（开发者推荐）

```bash
npm install -g synapse-sync
```

或不安装直接用：

```bash
npx synapse-sync msg list --json
```

### 方式 2：下载可执行文件（非技术人员推荐）

从 [GitHub Releases](https://github.com/codebricking/synapse/releases) 下载对应平台的文件：

| 平台 | 文件 |
|------|------|
| macOS (Apple Silicon) | `synapse-macos-arm64` |
| macOS (Intel) | `synapse-macos-x64` |
| Linux | `synapse-linux-x64` |
| Windows | `synapse-win-x64.exe` |

下载后：

```bash
# macOS / Linux
chmod +x synapse-macos-arm64
mv synapse-macos-arm64 /usr/local/bin/synapse

# Windows：把 exe 放到 PATH 里
```

无需安装 Node.js，双击或命令行直接运行。

### 方式 3：从源码构建

```bash
git clone <repo-url> synapse && cd synapse
npm install && npm run build
npm link
```

### 方式 4：零安装（产品/设计）

不装任何东西。团队里的开发者运行 `synapse serve --port 3000` 部署一个服务，你的 AI 直接调 HTTP API。

> **AI 操作指引：** 检查用户环境。如果有 Node.js → 推荐 `npm install -g synapse-sync`。如果没有 → 引导下载对应平台的可执行文件。如果是 PM/设计且团队已有服务 → 直接用 HTTP API，无需安装。

---

## 配置

在项目根目录创建 `synapse.yaml`。

### 开发者：Git + 本地存储

```yaml
project:
  name: my-backend
sync:
  git:
    repo: https://github.com/your-org/synapse-hub.git
    branch: main
```

### 开发者：Git + 飞书 Webhook 通知

```yaml
project:
  name: my-backend
sync:
  git:
    repo: https://github.com/your-org/synapse-hub.git
    branch: main
  larkWebhook:
    url: https://open.feishu.cn/open-apis/bot/v2/hook/xxxxxxxx
```

推送时代码变更存 Git，同时飞书群收到通知。拉取从 Git 读。

飞书 Webhook 配置：群设置 → 群机器人 → 添加「自定义机器人」→ 复制 Webhook URL。**无需创建企业应用，无需管理员审批。**

### PM/设计：HTTP 远程

```yaml
project:
  name: my-product
sync:
  http:
    url: http://192.168.1.100:3000
```

连接团队中某个开发者运行的 `synapse serve`。PM 的 AI 通过 HTTP 读写消息，不需要 git 也不需要飞书配置。

### 服务端：本地存储

```yaml
project:
  name: my-backend
sync:
  local:
    dir: ~/.synapse/local-messages
```

运行 `synapse serve` 时使用本地文件存储。不依赖 git 仓库，适合简单部署。

### 多渠道组合

```yaml
project:
  name: my-backend
sync:
  # primary: local     # 不设则默认 git > local > http > larkWebhook
  git:
    repo: https://github.com/your-org/synapse-hub.git
    branch: main
  local:
    dir: ~/.synapse/local-messages
  larkWebhook:
    url: https://open.feishu.cn/open-apis/bot/v2/hook/xxxxxxxx
```

### 多渠道行为

| 操作 | 行为 |
|------|------|
| Push | 广播到**所有**已配置的渠道，返回每个渠道的投递结果 |
| Pull | 只从**主渠道**读取（默认优先级 git > local > http > larkWebhook，可用 `primary` 覆盖） |

> **AI 操作指引：** 没有 `synapse.yaml` 时，询问用户角色和需要的渠道。开发者 → Git（+ 可选 larkWebhook 通知）。PM/设计 → HTTP（连团队服务）或 larkWebhook（只推送）。服务端 → local。`project.name` 从 `package.json` 或目录名推断。

---

## 使用

### CLI

```bash
# 推送消息
synapse msg send "标题" --role backend --category api_change --target api-user --content "详情" --metadata '{"type":"api_change","breaking":true,"endpoints":[{"method":"POST","path":"/api/users"}]}'

# 拉取消息
synapse msg list                                          # 最近 7 天
synapse msg list --category bug --assign-to frontend      # 分配给前端的 bug
synapse msg list --category api_change --limit 10         # 最近 10 个 API 变更
synapse msg list --role backend --json                    # 后端发的消息（JSON）

# 只看未处理的消息（避免重复浪费 token）
synapse msg list --unread --json                          # 只返回未 ack 的消息
synapse msg list --unread --ack --json                    # 拉取并自动标记已处理

# 手动标记已处理
synapse msg ack msg-20260310-abc123                       # 标记单条
synapse msg ack msg-20260310-abc123 msg-20260310-def456   # 标记多条
```

### HTTP API

```bash
synapse serve --port 3000
```

#### `POST /api/messages` — 推送

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
    "actual": "HTTP 500"
  }
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `title` | string | 是 | 一行摘要 |
| `content` | string | 是 | 详细描述 |
| `role` | string | 是 | `backend` / `frontend` / `pm` / `design` / `qa` |
| `category` | string | 否 | `bug` / `api_change` / `requirement` / `decision` / `status` / `note`，默认 `note` |
| `tags` | string[] | 否 | 标签 |
| `relatedFiles` | string[] | 否 | 相关文件 |
| `target` | string | 否 | 目标 MD 文件名（不含 `.md`），如 `api-user`、`decisions`。默认取 `category` |
| `metadata` | object | 否 | 结构化元数据，schema 按 category 不同（见下方） |
| `author` | string | 否 | 默认 `unknown` |
| `project` | string | 否 | 默认取配置中的 `project.name` |

**推送响应**（显示每个渠道的投递结果）：

```json
{
  "success": true,
  "message": { "id": "msg-20260309-a1b2c3", "..." : "..." },
  "deliveredTo": [
    { "transport": "git", "ok": true },
    { "transport": "larkWebhook", "ok": true }
  ]
}
```

#### `GET /api/messages` — 拉取（从主渠道）

| 参数 | 说明 |
|------|------|
| `since` | ISO 时间戳 |
| `role` | 按发送者角色过滤 |
| `category` | 按类别过滤 |
| `assignTo` | 按 metadata.assignTo 过滤（谁该处理） |
| `project` | 按项目过滤 |
| `limit` | 最大条数 |
| `unread` | `true` 时只返回未处理的消息 |

```bash
# 拉取分配给前端的 bug
curl "http://localhost:3000/api/messages?category=bug&assignTo=frontend&limit=10"

# 只拉取未处理的消息（避免 AI 重复处理浪费 token）
curl "http://localhost:3000/api/messages?unread=true&category=bug&assignTo=frontend"
```

#### `POST /api/messages/:id/ack` — 标记已处理

```bash
curl -X POST "http://localhost:3000/api/messages/msg-20260310-abc123/ack"
```

#### `POST /api/messages/ack` — 批量标记已处理

```bash
curl -X POST "http://localhost:3000/api/messages/ack" \
  -H "Content-Type: application/json" \
  -d '{"ids":["msg-20260310-abc123","msg-20260310-def456"]}'
```

#### `GET /api/messages/:id` — 单条

#### `GET /api/health`

```json
{
  "status": "ok",
  "transports": ["git", "local", "larkWebhook"],
  "primary": "git",
  "project": "my-backend",
  "version": "0.1.0"
}
```

---

## 结构化 Metadata

`metadata` 字段是自由格式，但推荐按 category 使用以下 schema，以便接收方 AI 能精准处理。

### Bug (`category: "bug"`)

```json
{
  "type": "bug",
  "severity": "critical | high | medium | low",
  "assignTo": "backend | frontend | ...",
  "endpoint": "GET /api/v1/users",
  "steps": ["步骤1", "步骤2"],
  "expected": "期望行为",
  "actual": "实际行为"
}
```

用途：前端发现后端接口有 bug，推送后后端 AI 拉取并修复。

### API Change (`category: "api_change"`)

```json
{
  "type": "api_change",
  "breaking": true,
  "endpoints": [{"method": "POST", "path": "/api/v1/users"}],
  "migration": "客户端需在注册表单新增手机号输入",
  "platforms": ["android", "ios", "web"]
}
```

用途：后端改了接口，客户端 AI 拉取后自动适配代码。

### Requirement (`category: "requirement"`)

```json
{
  "type": "requirement",
  "priority": "critical | high | medium | low",
  "platforms": ["android", "ios", "web"],
  "acceptanceCriteria": ["支持 jpg/png", "限制 5MB", "上传后立即显示"]
}
```

用途：产品定义需求，开发 AI 拉取后实现功能。

### 自定义

`metadata` 不做校验，任意 JSON 都可以。以上 schema 只是推荐。

---

## 多项目隔离

Synapse 的隔离边界是 **Git 仓库 / 本地目录 / HTTP 服务实例**，不是 `project.name`。

```
synapse-hub-ecommerce.git              ← 电商团队的共享仓库
├── projects/ecommerce-backend/        ← 后端的文档
│   ├── api-user.md
│   └── api-order.md
├── projects/ecommerce-ios/            ← iOS 的文档
│   └── integration.md
└── projects/ecommerce-web/            ← Web 的文档
                                       （互相可见，这是预期行为）

synapse-hub-internal.git               ← 内部工具团队的共享仓库
└── projects/admin-panel/              （和电商团队完全隔离）
```

| 层级 | 隔离方式 | 说明 |
|------|----------|------|
| **团队/产品线** | 不同的 Git 仓库 | 硬隔离，互不可见 |
| **同团队内的子项目** | `project.name` 字段 | 互相可见（这是需要的），可用 `--project` 过滤 |

### 实践建议

- 一个产品线（电商、内部工具、…）共享一个 Git 仓库
- 每个子项目（backend、iOS、web、pm）有自己的 `synapse.yaml`，指向同一个仓库，但 `project.name` 不同
- 拉取时默认能看到同仓库所有项目的消息；来自其他项目的消息会标注来源
- 不相关的产品线使用不同的仓库，天然隔离

> **AI 操作指引：** 生成 `synapse.yaml` 时，询问用户这个项目属于哪个团队/产品线。同团队的项目应使用同一个 Git 仓库地址。不同团队使用不同仓库。

---

## 典型工作流

### 场景 1：后端改了接口 → 客户端自动适配

```
后端 AI: synapse msg send "POST /users 新增 phone 字段" \
  --role backend --category api_change --target api-user \
  --content "..." --metadata '{"type":"api_change","breaking":true,...}'
  → 写入 projects/my-backend/api-user.md，覆盖同标题段落

客户端 AI: synapse msg list --category api_change --json
         → 发现 breaking change → 修改注册表单 → 推送确认

# 查看变更历史
git log -p projects/my-backend/api-user.md
```

### 场景 2：客户端发现后端 bug → 后端修复

```
客户端 AI: synapse msg send "用户列表分页 500" \
  --role frontend --category bug --target bug \
  --content "..." --metadata '{"type":"bug","severity":"high","assignTo":"backend",...}'

后端 AI: synapse msg list --category bug --assign-to backend --json
       → 发现 bug → 修复 → 推送 status 确认
```

### 场景 3：产品定义需求 → 多端实现（PM 用 HTTP 传输）

```
# PM 的 synapse.yaml 只配了 http:
#   url: http://192.168.1.100:3000

产品 AI: synapse msg send "支持头像上传" --role pm --category requirement \
  --target requirement --content "用户需要能上传头像..." \
  --metadata '{"type":"requirement","priority":"high",...}'
  → 通过 HTTP transport 推送到团队 synapse 服务

后端 AI: synapse msg list --category requirement --json → 实现上传接口
客户端 AI: synapse msg list --category requirement --json → 实现上传 UI
```

---

## AI 操作指引

### 首次配置

1. 检查是否有 `synapse.yaml`
2. 没有 → 问用户角色 → 开发者给 Git 地址 / PM 给团队服务 URL
3. 推断 project.name → 生成 synapse.yaml
4. 验证：`synapse msg list`

### 推送判断

| 改了什么 | 推不推 | category | target 建议 | metadata.assignTo |
|---------|--------|----------|-------------|-------------------|
| API 接口 | 推 | `api_change` | `api-{模块}` | — |
| 发现别人的 bug | 推 | `bug` | `bug` | 对方角色 |
| 新需求/变更需求 | 推 | `requirement` | `requirement` | — |
| 架构决策 | 推 | `decision` | `decisions` | — |
| 修复了 bug / 完成了适配 | 推 | `status` | `status` | — |
| 内部重构、格式化 | 不推 | — | — | — |

### 拉取策略

```bash
# 我是前端 → 拉我的 bug + 最新 API 变更 + 需求
synapse msg list --category bug --assign-to frontend --json
synapse msg list --category api_change --json
synapse msg list --category requirement --json

# 我是后端 → 拉我的 bug
synapse msg list --category bug --assign-to backend --json
```

读 `metadata` 决定行动：
- `bug` + `assignTo` 是自己 → 读 `expected`/`actual`/`steps`，定位并修复
- `api_change` + `breaking: true` → 读 `migration`，修改代码
- `requirement` → 读 `acceptanceCriteria`，逐条实现
