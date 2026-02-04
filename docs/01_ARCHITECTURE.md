## 1. 总体架构（Phase 1–2）

GoalFlow（MVP Phase 1–2）是一个 **Next.js App Router + Prisma(Postgres) + NextAuth(凭证登录) + xAI(grok-4-latest) + Zod** 的全栈应用。

### 1.1 模块划分

- **Web UI（App Router Pages）**：`app/`
  - Landing：`app/page.tsx`
  - Auth：`app/auth/signin/page.tsx`、`app/auth/signup/page.tsx`
  - Dashboard：`app/dashboard/page.tsx`
  - Create Goal（含问答） ：`app/goals/create/page.tsx`
  - Goal Detail：`app/goals/[id]/page.tsx`
- **API Route Handlers**：`app/api/**`
  - NextAuth：`app/api/auth/[...nextauth]/route.ts`
  - Signup：`app/api/auth/signup/route.ts`
  - Goal Analyze（生成问题）：`app/api/goals/analyze/route.ts`
  - Goal Create（落库 + 生成计划）：`app/api/goals/create/route.ts`
- **业务与基础库**：`lib/**`
  - Prisma client：`lib/prisma.ts`
  - NextAuth 配置：`lib/auth.ts`
  - Zod schemas：`lib/schemas/*`
  - LLM 封装：`lib/llm/xaiClient.ts`、`lib/llm/jsonGuard.ts`
  - AI Agents：`lib/agents/*`
- **提示词**：`prompts/*.md`（版本化，写入 DB 的 `Plan.promptVersion`）
- **数据库 schema**：`prisma/schema.prisma`

### 1.2 端到端核心链路（Goal → Q&A → Plan → UI）

#### A) 登录/注册

- 注册：
  - UI：`/auth/signup`
  - API：`POST /api/auth/signup`
  - DB：创建 `User`，密码使用 `bcryptjs.hash()` 存储
- 登录：
  - UI：`/auth/signin`
  - NextAuth Credentials provider：`lib/auth.ts`

#### B) 创建目标（两步：Analyze→Questions→Create）

1) 用户在 `app/goals/create/page.tsx` 输入 `title`（可选 `category`），点击 Continue
2) 前端调用：
   - `POST /api/goals/analyze`
   - xAI 调用 `GoalAnalyzer` 生成 3–5 个问题（带建议选项）
3) 前端逐题展示 `components/goal-questions.tsx`，收集 `answers: Record<string,string>`
4) 回答完后调用：
   - `POST /api/goals/create`，body 包含 `{ title, category, answers }`
5) 后端 `app/api/goals/create/route.ts`：
   - 调用 `extractGoalSpec()`：把 title/category/answers 合并后交给 LLM 结构化成 `GoalSpec`（Zod 校验）
   - 落库 `Goal`
   - 调用 `generatePlan()`：用 GoalSpec 生成 7 天 `Plan`（Zod 校验+重试+fallback）
   - 落库 `Plan`、`Task`（按 day/tasks 展开）
   - 写 `EventLog`（`goal_created`）
6) 前端跳转 `/goals/:id` 展示计划、任务、事件

### 1.3 关键设计原则

- **所有 LLM 调用只在服务端执行**：密钥只从 env 读取，不下发到前端
- **LLM 输出必须严格 JSON**：`JSONGuard.callAndValidate()` 解析 + Zod 校验
- **校验失败重试 2 次**：每次带上 schema 错误（最多截取 3 条）指导修复
- **仍失败 fallback**：使用模板生成最小可用的 `GoalSpec/Plan/WeeklyReview`
- **提示词版本化**：`prompts/*.md` 顶部 `prompt_version`；`Plan.promptVersion` 写入版本字符串（目前写死 `v1.0.0`，后续可改为自动读取 prompt 顶部版本）

### 1.4 MVP 范围声明

Phase 1–2 已打通：
- Auth、Goal 创建、LLM 结构化+计划生成、落库、Goal 详情展示

未实现（Phase 3–4）：
- Email/Resend 实发
- OneTimeToken check-in 落地页
- WeeklyReviewer 的自动触发与 plan patch 应用
- 徽章/成就发放逻辑（DB 结构已预留）

