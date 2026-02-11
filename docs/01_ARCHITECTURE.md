## 1. 总体架构（Phase 1–5）

GoalFlow 是一个 **Next.js App Router + Prisma(Postgres) + NextAuth(凭证登录) + xAI(grok-4-latest) + Zod** 的全栈 AI 目标管理应用。

### 1.1 模块划分

- **Web UI（App Router Pages）**：`app/`
  - Landing：`app/page.tsx`
  - Auth：`app/auth/signin/page.tsx`、`app/auth/signup/page.tsx`
  - Dashboard：`app/dashboard/page.tsx`
  - Create Goal（对话 + 计划预览）：`app/goals/create/page.tsx`
  - Goal Detail：`app/goals/[id]/page.tsx`（含 checkin 状态指示 + weekly review 入口 + review 历史卡片）
  - Authenticated Review：`app/goals/[id]/review/page.tsx`
  - Token Checkin：`app/checkin/[token]/page.tsx`
  - Token Review：`app/review/[token]/page.tsx`
- **API Route Handlers**：`app/api/**`
  - NextAuth：`app/api/auth/[...nextauth]/route.ts`
  - Signup：`app/api/auth/signup/route.ts`
  - Goal Analyze：`app/api/goals/analyze/route.ts`
  - Goal Create：`app/api/goals/create/route.ts`
  - Goal Conversation：`app/api/goals/conversation/route.ts`（SSE streaming）
  - Goal Delete：`app/api/goals/[id]/delete/route.ts`
  - Checkin：`app/api/checkin/route.ts` + `app/api/checkin/token/route.ts`
  - Weekly Review：`app/api/weekly-review/route.ts`（POST/GET/PATCH）+ `token/route.ts`
  - Badges：`app/api/badges/route.ts`
  - Profile：`app/api/profile/route.ts`
  - Tokens：`app/api/tokens/route.ts`
  - Cron：`app/api/cron/daily-email/route.ts`、`app/api/cron/weekly-review/route.ts`
- **AI Agent 系统**：`lib/agents/*`
  - Classifier → Domain Expert → Plan Generator → Plan Modifier → Weekly Reviewer
  - Orchestrator 自动路由 fast/deep 路径
- **业务与基础库**：`lib/**`
  - LLM 封装（sync + streaming）：`lib/llm/xaiClient.ts`、`lib/llm/jsonGuard.ts`
  - Zod schemas：`lib/schemas/*`
  - 领域知识库：`lib/knowledge/*`
  - 约束校验器：`lib/constraints/*`
  - 用户画像管理：`lib/profile/*`
  - Email 服务：`lib/email/*`
  - 徽章系统：`lib/badges.ts`
  - Token 管理：`lib/tokens.ts`
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

### 1.4 已完成功能范围

Phase 1–5 已打通：
- Auth、Goal 创建（对话式 + 快速路径）、智能 Agent 分类/对话/计划生成
- 领域知识库注入、代码级约束校验、用户画像持久化
- Email 服务（Resend）、每日 checkin 邮件、每周 review 邮件
- OneTimeToken checkin/review 落地页
- Badge 徽章系统
- Goal Detail 页面（checkin 状态可视化、weekly review 入口）
- Weekly Review 闭环（checkin → 状态显示 → review 生成 → 选择下周方案 → 新 plan）
- Weekly Review UX（review 历史卡片、按钮状态管理、防重复生成）
- SSE Streaming 底层支持（xaiClient + jsonGuard）
- Plan 版本管理 + 修改历史

待完善：
- SSE Streaming 前端 UI 集成
- Dashboard 统计卡片优化
- E2E 测试
- 生产部署配置

