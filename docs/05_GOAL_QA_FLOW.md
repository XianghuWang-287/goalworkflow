## 5. Goal Analyzer 问答流程（更自动化的目标收集）

### 5.1 目标

用户只输入一句话 goal title 时，信息不足会导致：
- 计划过于泛
- 或者对习惯类目标给出“无用的学习任务”

因此 Phase 1–2 增加“问 3–5 个问题”的中间层：

1) LLM 先判断 goal 类型与缺失信息
2) 自动生成“澄清问题 + 建议选项”
3) 用户低成本选择/输入
4) 用这些答案补全 GoalSpec，再生成 Plan

### 5.2 数据结构

#### 5.2.1 分析结果（GoalAnalysis）

服务端返回：

- `goalType`：
  - `simple_habit`：简单习惯（早睡/喝水/冥想等）
  - `learning`：学习/技能
  - `complex`：复杂/不确定（默认）
- `needsMoreInfo`：是否需要继续问
- `questions[]`：问题列表（3–5 个）

每个问题：

- `question: string`：问题文本
- `type: "text" | "select" | "number"`
- `field: string`：映射到 GoalSpec 的字段名
  - **必须是**：`description | timeframe | currentLevel | desiredOutcome | constraints`
- `suggestions?: string[]`：建议选项（select 类型）
- `placeholder?: string`

实现文件：
- Agent：`lib/agents/goalAnalyzer.ts`
- API：`app/api/goals/analyze/route.ts`

### 5.3 UI 交互（逐题 + 建议选项 + 可自定义）

组件：`components/goal-questions.tsx`

交互特点：
- 一次只显示 1 题（降低认知负担）
- `select` 题：
  - 按钮形式建议选项（点击即填）
  - 分割线下提供“自定义输入”（可覆盖建议）
- `text/number` 题：标准输入框
- 不能空着进入下一题

### 5.4 与 GoalSpec 的合并方式

创建 API：`POST /api/goals/create`（`app/api/goals/create/route.ts`）

请求体：

- `title`
- `category?`
- `answers?`：`Record<string,string>`

服务端合并：

```ts
const goalSpecInput = { title, category, ...answers }
const goalSpec = await extractGoalSpec(goalSpecInput)
```

注意点：
- `extractGoalSpec` 会把所有输入字段（包括问答字段）拼成 prompt，让 LLM 结构化为 `GoalSpecSchema`
- `constraints` 可能被 UI 以字符串形式传入，因此 `extractGoalSpec` 对 constraints 做了 array/string 兼容处理（见 `docs/07_TROUBLESHOOTING.md`）

### 5.5 场景策略（当前 + 建议优化）

#### 当前（已实现）
- 统一由 LLM 生成问题（根据 title/category 自判断）
- 前端渲染为表单问题

#### 建议优化（后续）

1) **给 Agent 加“硬规则模板”**：
   - 简单习惯类（sleep/drink/meditate）固定问：
     - 目标具体指标（几点前睡 / 每天几杯水）
     - 现状（现在几点睡 / 现在每天几杯）
     - 频率（每周几天）
     - 约束（工作/通勤/家庭）
     - 时间线（先做 7 天 / 2 周 / 1 月）
   - 学习类固定问：
     - 每天时间投入（30/60/90/120 min）
     - 当前水平（0基础/入门/有经验）
     - 目标产出（做一个项目/通过面试/看懂源码）
     - 总周期（1周/2周/1月/2月）
     - 约束（只能周末/碎片时间）

2) **把答案直接写入 GoalSpec（不再让 LLM “再抽取一次”）**：
   - 现在是：answers → LLM → GoalSpec
   - 可改为：title/category + answers → 直接构造 GoalSpec，再用 LLM 仅“补全缺失/标准化”

3) **对 `constraints` 提供多选 UI**：
   - 目前是 text/select，导致 constraints 可能是 string
   - 后续可以改为 tag/multi-select，天然产出 string[]

