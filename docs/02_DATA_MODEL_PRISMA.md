## 2. 数据模型（Prisma / PostgreSQL）

Prisma schema：`prisma/schema.prisma`

### 2.1 认证相关（NextAuth）

这些模型是 NextAuth 标准表结构（用于 credentials/JWT session 等）：

- **User**（`users`）
  - `id`：cuid
  - `email`：唯一（可空）
  - `password`：credentials 登录使用（bcrypt hash）
  - 关联：`goals[]`、`accounts[]`、`sessions[]`
- **Account**（`accounts`）：OAuth 时使用（Phase 1–2 仍保留结构）
- **Session**（`sessions`）：如果改为 DB session strategy 会用到（当前是 JWT strategy）
- **VerificationToken**（`verification_tokens`）：email magic link 时会用到（未来可选）

### 2.2 业务模型

#### Goal

表：`goals`

- `id`：cuid
  - **归属**：`userId -> User`
- `title`：展示标题（来自 LLM GoalSpec 或用户输入）
- `category`：可选（习惯/学习/健康等）
- `goalSpecJson`：JSON（严格结构由 `GoalSpecSchema` 定义）
- `status`：`active | completed | paused | archived`（目前主要用 `active`）
- `createdAt/updatedAt`
- 关联：`plans[]`、`tasks[]`、`checkins[]`、`weeklyReviews[]`、`eventLogs[]`、`badges[]`、`oneTimeTokens[]`

#### Plan

表：`plans`

- `goalId -> Goal`
- `startDate`
- `planJson`：JSON（严格结构由 `PlanSchema` 定义，当前为 7 天 * 1 周）
- `version`：默认 1（为 Phase 4 的 plan versioning 预留）
- `status`：`active | superseded | completed`（Phase 1–2 主要用 `active`）
- `promptVersion`：记录生成该 plan 使用的 prompt 版本（当前写 `v1.0.0`）
- `createdAt/updatedAt`
- 关联：`tasks[]`

#### Task

表：`tasks`

Task 是 Plan 的“展开”表（便于按日期查询、今日任务等）。

- `goalId -> Goal`
- `planId -> Plan`
- `date`：该日日期（与 planJson 对齐，存 DateTime）
- `dayIndex`：0–6（day0 = startDate）
- `taskJson`：JSON（严格结构由 `TaskSchema` 定义）
- `status`：`pending | done | partial | missed`
- `completedAt`
- 索引：
  - `@@index([goalId, date])`

#### Checkin（Phase 3 会更完善）

表：`checkins`

- `goalId -> Goal`
- `date`：每天唯一
- `status`：`done | partial | missed`
- `note`：可选文本
- `createdVia`：`web | email`（Phase 1–2 主要为 web）
- 约束与索引：
  - `@@unique([goalId, date])`
  - `@@index([goalId, date])`

#### WeeklyReview（Phase 4 会更完善）

表：`weekly_reviews`

- `goalId -> Goal`
- `weekIndex`：0,1,2...
- `reviewJson`：JSON（严格结构由 `WeeklyReviewSchema` 定义）
- `chosenOption`：0/1/2（选择了哪个 next_week_options）
- `@@unique([goalId, weekIndex])`

#### OneTimeToken（Phase 3）

表：`one_time_tokens`

- 用途：email 一键 check-in/周复盘无需登录入口
- 字段：`purpose`、`token`（unique）、`expiresAt`、`usedAt`

#### EventLog

表：`event_logs`

- `goalId -> Goal`
- `type`：事件类型（如 `goal_created`）
- `payloadJson`：任意 JSON
- `createdAt`
- 索引：
  - `@@index([goalId, createdAt])`

#### Badge（Phase 4）

表：`badges`

- `userId -> User`
- `goalId -> Goal`
- `badgeType`：`first_checkin | streak_3 | streak_7 | first_weekly_review`
- `earnedAt`
- 约束：
  - `@@unique([userId, goalId, badgeType])`

### 2.3 迁移与同步方式

Phase 1–2 推荐：

- `npm run db:generate`：生成 Prisma Client
- `npm run db:push`：推 schema 到数据库（不生成 migrations）

如果你要走正式 migrations（更适合团队协作/生产）：

- `npm run db:migrate`（会生成 migrations）

