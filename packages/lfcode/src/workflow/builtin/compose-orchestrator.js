export const meta = {
  name: 'compose-orchestrator',
  description: 'Compose orchestration workflow — classifies the task first, then routes it into the lightest safe strategy from direct execution to full parallel orchestration.',
  whenToUse: 'Use for large or ambiguous compose-mode engineering work that should be classified by type and difficulty before choosing between direct execution, research/design-first, or full multi-stage orchestration.',
  phases: [
    { title: "Inspect", detail: "Read the current code, tests, and runtime evidence first" },
    { title: "Route", detail: "Classify the task by type, difficulty, and execution shape before choosing a strategy" },
    { title: "Plan", detail: "Turn the task into a concrete implementation plan and identify independent work streams when the route requires it" },
    { title: "Execute", detail: "Run independent work streams in parallel where possible" },
    { title: "Review", detail: "Review the changes against the plan and remove anything that drifted when the route requires it" },
    { title: "Verify", detail: "Run the relevant tests or build checks and return only when they pass" },
  ],
}

const inspectSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    summary: { type: "string" },
    files: { type: "array", items: { type: "string" } },
    symbols: { type: "array", items: { type: "string" } },
    tests: { type: "array", items: { type: "string" } },
    evidence: { type: "array", items: { type: "string" } },
  },
  required: ["summary", "files", "symbols", "tests", "evidence"],
}

const planSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    summary: { type: "string" },
    workstreams: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          id: { type: "string" },
          title: { type: "string" },
          goal: { type: "string" },
          prompt: { type: "string" },
          verification: { type: "array", items: { type: "string" } },
        },
        required: ["id", "title", "goal", "prompt", "verification"],
      },
    },
    verification: { type: "array", items: { type: "string" } },
  },
  required: ["summary", "workstreams", "verification"],
}

const routeSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    summary: { type: "string" },
    taskType: {
      type: "string",
      enum: ["bug-fix", "small-feature", "refactor", "investigation", "design", "migration", "large-project"],
    },
    difficulty: {
      type: "string",
      enum: ["simple", "moderate", "complex", "very-complex"],
    },
    strategy: {
      type: "string",
      enum: ["direct-execute", "research-then-execute", "design-then-execute", "full-orchestration"],
    },
    requiresTaskBoard: { type: "boolean" },
    requiresPlan: { type: "boolean" },
    requiresReview: { type: "boolean" },
    executionShape: {
      type: "string",
      enum: ["single-shot", "research-first", "design-first", "multi-workstream"],
    },
  },
  required: [
    "summary",
    "taskType",
    "difficulty",
    "strategy",
    "requiresTaskBoard",
    "requiresPlan",
    "requiresReview",
    "executionShape",
  ],
}

const reviewSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    passed: { type: "boolean" },
    summary: { type: "string" },
    drift: { type: "array", items: { type: "string" } },
    gaps: { type: "array", items: { type: "string" } },
  },
  required: ["passed", "summary", "drift", "gaps"],
}

const verifySchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    passed: { type: "boolean" },
    summary: { type: "string" },
    evidence: { type: "array", items: { type: "string" } },
    remaining: { type: "array", items: { type: "string" } },
  },
  required: ["passed", "summary", "evidence", "remaining"],
}

const task = typeof args === "string" ? args : JSON.stringify(args)
if (!task) {
  return { error: "No compose task provided." }
}

const asArray = (value) => Array.isArray(value) ? value : []
const summarizeGate = (label, result) => {
  const summary = result && typeof result.summary === "string" ? result.summary : `The ${label.toLowerCase()} stage did not return a usable summary.`
  const details = asArray(result && result.remaining ? result.remaining : result && result.gaps ? result.gaps : [])
  throw new Error(`${label} gate failed: ${summary}${details.length ? ` Remaining: ${details.join("; ")}` : ""}`)
}

phase("Inspect")
const inspect = await agent(
  "You are inspecting a large engineering task for compose mode.\n\n" +
    "Task:\n" + task + "\n\n" +
    "Return only structured output. Identify the exact files, symbols, tests, and runtime evidence that matter. Do not edit anything yet.",
  { label: "compose:inspect", phase: "Inspect", schema: inspectSchema },
)

phase("Route")
const route = await agent(
  "You are routing a compose-mode engineering task.\n\n" +
    "Task:\n" + task + "\n\n" +
    "Inspection notes:\n" + JSON.stringify(inspect) + "\n\n" +
    "Return only structured output.\n" +
    "Classify the task by type, difficulty, and execution shape.\n" +
    "Choose the lightest safe strategy:\n" +
    "- direct-execute for small clear localized work\n" +
    "- research-then-execute when current behavior or facts must be gathered first\n" +
    "- design-then-execute when architecture or design is still open\n" +
    "- full-orchestration when the work is multi-stage, ambiguous, or naturally parallel\n" +
    "Only require a task board, plan, or review when the task shape justifies it.",
  { label: "compose:route", phase: "Route", schema: routeSchema },
)

const strategy = route && typeof route.strategy === "string" ? route.strategy : "full-orchestration"
const requiresPlan = route && route.requiresPlan === true
const requiresReview = route && route.requiresReview === true

const defaultPlan = {
  summary: route && typeof route.summary === "string" ? route.summary : "Direct execution route selected.",
  workstreams: [
    {
      id: "W1",
      title: strategy,
      goal: route && typeof route.summary === "string" ? route.summary : "Complete the assigned compose task.",
      prompt:
        "Handle this task using the routed compose strategy.\n" +
        "If the route says direct-execute, keep the solution narrowly scoped.\n" +
        "If the route says research-then-execute or design-then-execute, do that focused front-loaded work first, then implement.",
      verification: [],
    },
  ],
  verification: [],
}

const plan = requiresPlan
  ? await (async () => {
      phase("Plan")
      return agent(
        "You are turning a compose engineering task into a concrete implementation plan.\n\n" +
          "Task:\n" + task + "\n\n" +
          "Inspection notes:\n" + JSON.stringify(inspect) + "\n\n" +
          "Route:\n" + JSON.stringify(route) + "\n\n" +
          "Return only structured output. Split the work into the minimum independent workstreams that can run in parallel.\n" +
          "Each workstream prompt must be self-contained and specific enough for a subagent to execute directly.\n" +
          "For multi-step work, create or update the session task board with the task tool before you return the plan.",
        { label: "compose:plan", phase: "Plan", schema: planSchema },
      )
    })()
  : defaultPlan

const workstreams = asArray(plan && plan.workstreams).filter(
  (stream) =>
    stream &&
    typeof stream.id === "string" &&
    typeof stream.title === "string" &&
    typeof stream.goal === "string" &&
    typeof stream.prompt === "string",
)

phase("Execute")
const execute = await parallel(
  workstreams.length
    ? workstreams.map((stream, index) => () =>
        agent(
          "Implement this compose workstream.\n\n" +
            "Task:\n" + task + "\n\n" +
            "Route:\n" + JSON.stringify(route) + "\n\n" +
            "Overall plan:\n" + JSON.stringify(plan) + "\n\n" +
            "Assigned workstream:\n" + JSON.stringify(stream) + "\n\n" +
            "Match the routed strategy exactly.\n" +
            "For direct-execute, stay narrow and do not invent extra phases.\n" +
            "For research-then-execute, gather the missing facts before changing code.\n" +
            "For design-then-execute, settle the design boundary before broad edits.\n" +
            "For full-orchestration, keep the task board current if your work changes scope.\n" +
            "Report files touched plus verification you ran.",
          { label: `compose:execute-${index + 1}`, phase: "Execute" },
        ),
      )
    : [() => ({ status: "noop", reason: "No executable workstreams were planned." })],
)

const review = requiresReview
  ? await (async () => {
      phase("Review")
      return agent(
        "Review the compose task changes against the plan.\n\n" +
          "Task:\n" + task + "\n\n" +
          "Route:\n" + JSON.stringify(route) + "\n\n" +
          "Plan:\n" + JSON.stringify(plan) + "\n\n" +
          "Execution:\n" + JSON.stringify(execute) + "\n\n" +
          "Return only structured output. Set passed=false if there is drift, missing work, or unnecessary changes that should block handoff.",
        { label: "compose:review", phase: "Review", schema: reviewSchema },
      )
    })()
  : {
      passed: true,
      summary: "Review skipped because the routed strategy did not require a formal review gate.",
      drift: [],
      gaps: [],
    }

phase("Verify")
const verify = await agent(
  "Verify the compose task outcome.\n\n" +
    "Task:\n" + task + "\n\n" +
    "Route:\n" + JSON.stringify(route) + "\n\n" +
    "Plan:\n" + JSON.stringify(plan) + "\n\n" +
    "Review:\n" + JSON.stringify(review) + "\n\n" +
    "Run the relevant tests, build steps, or other concrete checks when possible, and return only structured output.\n" +
    "Set passed=false if verification evidence is weak, incomplete, or still failing.",
  { label: "compose:verify", phase: "Verify", schema: verifySchema },
)

if (!review || review.passed !== true) summarizeGate("Review", review)
if (!verify || verify.passed !== true) summarizeGate("Verify", verify)

return { inspect, route, plan, execute, review, verify }
