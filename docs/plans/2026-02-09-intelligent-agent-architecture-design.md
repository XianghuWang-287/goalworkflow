# GoalFlow 智能 Agent 架构设计

> 日期: 2026-02-09
> 状态: 已确认，待实施

## 1. 背景与问题

当前系统的目标创建和计划生成存在以下核心问题：

- **计划太泛**: 复杂目标（如减肥）只生成"吃东西+锻炼"，缺少具体数值（卡路里、运动类型、时间安排）
- **提问太浅**: 问题像表单填空，不像真正理解用户目标的 agent
- **不分轻重**: 简单目标（早睡）过度复杂化，复杂目标（减肥）又过于简单
- **约束被忽略**: 用户声明的约束（如某几天不可用）在生成的计划中被无视
- **缺乏个性化**: 没有用户画像，每次都从零开始

## 2. 设计目标

从"模板填充式计划生成"升级为"智能 Agent 式目标规划系统"：

- 根据目标复杂度自动选择快速路径或深度对话路径
- 领域专家级的对话能力，基于知识库给出专业建议和具体数值
- 持久化用户画像，跨目标复用，避免重复提问
- 多目标时间协调，自动避免冲突
- 约束通过代码硬校验，不依赖 LLM
- 用户可通过卡片操作或自然语言对话修改计划

## 3. 整体架构

### 3.1 三层架构

**智能分类层 (Goal Classifier)**

用户输入目标后，AI 快速判断：
- 目标领域: 健身、习惯、学习、理财、求职、创作、心理健康、社交、生活管理、戒除坏习惯
- 复杂度等级: 简单 → 中等 → 复杂
- 计划结构类型: 固定周期 / 阶段式 / 倒推式

简单目标直接生成计划，复杂目标进入深度对话。

**领域专家对话层 (Domain Expert Agent)**

根据分类结果，加载对应领域的知识库和专家人设，进行多轮对话：
- 结合用户画像（已有的作息、偏好、身体数据）
- 检查与其他活跃目标的时间冲突
- 用领域知识给出专业建议和具体数值

**计划生成与协调层 (Plan Generator + Coordinator)**

生成计划时：
- 严格遵守用户声明的约束（不可用的日期、时间段）
- 与其他活跃目标协调，避免冲突
- 根据目标类型自动选择计划结构和时间粒度
- Constraint Validator 做代码级硬校验

### 3.2 Agent 拆分

| Agent | 职责 | 调用时机 |
|-------|------|----------|
| Goal Classifier | 判断领域、复杂度、计划结构 | 用户输入目标时 |
| Profile Collector | 检查并补充缺失的用户画像 | 分类后、生成前 |
| Domain Expert | 领域专家多轮对话，输出 GoalSpec | 复杂目标 |
| Plan Generator | 生成具体计划 + Constraint Validator | GoalSpec 确定后 |
| Plan Modifier | 处理用户的对话式修改请求 | 用户修改计划时 |

### 3.3 数据流

```
用户输入目标
    → 规则预判（代码，零延迟）
    → 简单目标: 单次 LLM 调用（分类+生成合并）→ Constraint Validator → 预览
    → 复杂目标: Goal Classifier → Profile Collector → Domain Expert(多轮对话)
                → Plan Generator → Constraint Validator → 预览
    → 用户预览 → 卡片微调 / Plan Modifier 对话修改
    → 确认 → 保存为 PlanVersion v1 → 开始执行
```

## 4. 用户画像系统

### 4.1 数据结构

**基础画像（注册后逐步收集）：**
- 作息时间: 起床时间、睡觉时间
- 工作日/休息日安排
- 每日可用时间段
- 所在时区

**领域画像（创建相关目标时收集，持久保存）：**
- 健身类: 身高、体重、运动经验、饮食偏好、有无伤病
- 学习类: 当前水平、学习风格偏好、可用学习工具
- 理财类: 月收入范围、固定支出、储蓄目标
- 其他领域按需扩展

### 4.2 收集策略

- 创建第一个目标时，顺带收集基础画像（3-5 个问题）
- 创建特定领域目标时，收集该领域画像
- 已有的画像数据自动复用，不重复问
- 用户可以随时在设置页修改画像

### 4.3 跨目标协调

- 拉取所有活跃目标的已占用时间段
- 对话中告知用户冲突（"你周二晚上已经有学英语的安排"）
- 生成计划时自动避开冲突

## 5. 领域知识库设计

### 5.1 目录结构

```
lib/knowledge/
  ├── fitness.json      # 健身减肥
  ├── habit.json        # 习惯养成
  ├── learning.json     # 学习
  ├── finance.json      # 理财储蓄
  ├── career.json       # 求职/副业
  ├── mental.json       # 心理健康
  ├── creative.json     # 创作类
  ├── social.json       # 社交关系
  ├── lifestyle.json    # 生活管理
  ├── quit.json         # 戒除坏习惯
  └── _base.json        # 通用知识（时间管理、动机理论等）
```

### 5.2 知识内容（以 fitness.json 为例）

- **运动数据**: 运动类型、每30分钟卡路里消耗、适合人群、所需器材
- **饮食数据**: 常见食物热量、推荐每日摄入公式（基于体重/身高/活动量）
- **安全规则**: 每周最大减重量、最低卡路里摄入、休息日要求
- **阶段模板**: 减肥通常分几个阶段、每阶段重点
- **专家人设 prompt**: 该领域 AI 的说话风格和关注点

### 5.3 注入方式

`KnowledgeProvider` 接口:
- `getKnowledge(domain, context)` — 根据领域和用户具体情况返回相关知识片段
- 注入到 agent 的 system prompt 中
- 接口抽象好，以后换成 RAG 只需新增实现

### 5.4 未覆盖领域降级

用户目标不属于任何已有领域时，加载 `_base.json`（通用知识），以通用教练模式运行。

## 6. 计划生成

### 6.1 计划结构类型

**固定周期型**（习惯养成、早睡、戒除类）
- 直接生成完整周期（如 21 天）
- 每天任务相对固定，逐步递进

**阶段式**（减肥、学习、创作类）
- 先生成总计划大纲（如 3 个月分 3 阶段）
- 每周细化为具体的 7 天任务
- 每个任务包含具体数值

**倒推式**（求职、考试、项目截止日期类）
- 从目标日期倒推
- 按里程碑拆解，再细化到每周每天

### 6.2 Constraint Validator（纯代码，不经过 LLM）

校验规则:
- 任务日期不在 `constraints.unavailableDates` 中
- 任务时间段在用户 `availableSlots` 内
- 不与其他活跃目标的任务时间冲突
- 校验失败 → 自动重新生成（最多 3 次）
- 3 次都失败 → 展示最接近版本 + 高亮违规部分让用户手动调整

### 6.3 计划版本管理

- 每次修改生成新的 PlanVersion，只增不改
- 记录变更来源（initial / user_edit / weekly_review / ai_adjust）
- Weekly Review 可对比版本历史分析执行情况

## 7. 数据模型变更

### 7.1 新增表

**UserProfile**
```prisma
model UserProfile {
  id             String   @id @default(cuid())
  userId         String   @unique
  user           User     @relation(fields: [userId], references: [id])
  wakeUpTime     String?  // "07:00"
  sleepTime      String?  // "23:00"
  workDays       Json?    // [1,2,3,4,5]
  availableSlots Json?    // [{"day":"weekday","start":"07:00","end":"08:00"}]
  timezone       String?  // "Asia/Shanghai"
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt
}
```

**DomainProfile**
```prisma
model DomainProfile {
  id        String   @id @default(cuid())
  userId    String
  user      User     @relation(fields: [userId], references: [id])
  domain    String   // "fitness", "learning", etc.
  data      Json     // 领域特定数据，schema 由知识库定义
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@unique([userId, domain])
}
```

**Conversation**
```prisma
model Conversation {
  id        String   @id @default(cuid())
  goalId    String
  goal      Goal     @relation(fields: [goalId], references: [id])
  agentType String   // "domain_expert" | "plan_modifier"
  messages  Json     // [{role, content, timestamp}]
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}
```

**PlanVersion**
```prisma
model PlanVersion {
  id            String   @id @default(cuid())
  planId        String
  plan          Plan     @relation(fields: [planId], references: [id])
  version       Int
  content       Json     // 该版本完整计划
  changeSource  String   // "initial" | "user_edit" | "weekly_review" | "ai_adjust"
  changeSummary String?
  createdAt     DateTime @default(now())
}
```

### 7.2 改造现有表

**GoalSpec 新增字段:**
- `domain` String — 目标领域
- `complexity` String — 复杂度 (simple/medium/complex)
- `planStructure` String — 计划结构类型 (fixed_cycle/phased/countdown)
- `constraints` Json — 结构化约束

**Plan 新增字段:**
- `phases` Json? — 阶段数据
- `totalDuration` Int — 总天数
- `currentPhase` Int — 当前阶段索引
- `currentWeek` Int — 当前周数

**Task 增强:**
- `specificValues` Json? — 具体数值（卡路里、时长、具体动作等）
- `timeSlot` String? — 具体时间段 ("07:00-08:00")

## 8. 前端交互设计

### 8.1 目标创建流程

**Step 1: 输入页**
- 简洁输入框: "你想达成什么目标？"
- 提交后显示加载状态

**Step 2a: 快速路径（简单目标）**
- 可能插 1-2 个内联确认问题
- 直接跳到计划预览页

**Step 2b: 深度路径（复杂目标）**
- 聊天界面，AI 一次问一个问题
- 支持文字回复 + 快捷选项按钮
- 顶部进度提示（了解情况 → 制定方案 → 生成计划）
- 对话结束时 AI 总结确认

**Step 3: 计划预览页**
- 顶部: 目标摘要卡片（目标、时长、阶段概览）
- 中间: 任务卡片列表，按天/周分组
  - 每张卡片: 时间、内容、具体数值、预计时长
  - 点击编辑、长按拖拽、滑动删除
- 底部固定栏:
  - "跟 AI 调整" → 弹出对话框进行大改动
  - "确认计划" → 保存并开始执行

**Step 4: 目标详情页（改造现有）**
- 新增阶段进度条（阶段式计划）
- 新增倒计时（倒推式计划）
- 任务卡片显示具体数值
- CheckIn 时可记录实际完成数值

## 9. 错误处理与边界情况

### 9.1 LLM 相关

- **计划不合格**: Constraint Validator 校验失败，自动重试最多 3 次；3 次都失败则展示最接近版本 + 高亮违规部分让用户手动调整
- **JSON 解析失败**: 现有 JsonGuard 机制保留（Zod 校验 + 重试 + 降级）
- **对话跑偏**: Domain Expert 对话超过 15 轮未收集够信息，自动总结已有信息，问用户是否先基于现有信息生成计划

### 9.2 用户行为

- **中途放弃对话**: 对话状态保存在 Conversation 表，下次回来可继续
- **修改导致不可行**: Plan Modifier 提示问题而非生成空计划
- **跨目标冲突无法解决**: 提示用户时间已满，建议先完成或暂停一个目标

### 9.3 数据一致性

- **画像更新影响已有计划**: 不自动改已有计划，在下次 Weekly Review 时提示调整
- **PlanVersion 只增不改**: 每次修改都是新版本，永远可回溯

## 10. Weekly Review 与 Daily CheckIn 适配

### 10.1 Weekly Review

- 感知当前阶段 (`plan.currentPhase`) 和周数 (`plan.currentWeek`)
- 查询 PlanVersion 历史，对比原计划 vs 实际执行 vs 修改历史
- 决策: 继续当前阶段 / 进入下一阶段 / 调整阶段目标
- 兼容新旧两种计划格式

### 10.2 Daily CheckIn

- 从 `Plan.currentWeek` 对应日期取任务
- 任务包含 `specificValues` 和 `timeSlot`
- 邮件提醒内容具体化（"下午 5:00 跑步 30 分钟，目标消耗 300 卡"）
- 签到时可记录实际完成数值

## 11. 迁移策略

### 11.1 数据库迁移

- 新增表不影响现有数据
- GoalSpec、Plan、Task 新增字段设为 optional，旧数据兼容
- 旧目标 `domain` 默认 `"general"`，`complexity` 默认 `"simple"`
- 现有计划自动创建 PlanVersion v1

### 11.2 功能切换

- 新目标创建流程替换旧流程，旧目标正常查看和签到
- 旧 Agent 逐步替换，旧代码保留到新系统稳定后再删
- Weekly Review 和 Daily CheckIn 兼容两种计划格式

### 11.3 实施顺序

1. 数据模型变更 + UserProfile 系统
2. 知识库框架 + 基础数据填充
3. Goal Classifier + 快速/深度路径分叉
4. Domain Expert Agent（核心对话能力）
5. 新 Plan Generator + Constraint Validator
6. 计划预览页 + 卡片式/对话式修改
7. Weekly Review 和 Daily CheckIn 适配
8. 补充更多领域知识库
