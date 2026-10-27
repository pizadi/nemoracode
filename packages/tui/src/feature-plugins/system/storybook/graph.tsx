/** @jsxImportSource @opentui/solid */
import type { GraphInfo, GraphNodeRow, GraphTaskLedger, GraphWorkingSetSnapshot } from "@nemoracode/client"
import type { Plugin } from "@nemoracode/plugin/tui"
import { useTerminalDimensions } from "@opentui/solid"
import { createSignal } from "solid-js"
import { GraphViewer } from "../graph"
import type { Story } from "./index"
import { StoryFooter } from "./footer"

const treeRows: GraphNodeRow[] = [
  { id: ".", kind: "directory", ord: 0, status: "skeleton" },
  { id: "src", kind: "directory", parent: ".", ord: 0, status: "skeleton" },
  { id: "src/graph", kind: "directory", parent: "src", ord: 0, status: "skeleton" },
  {
    id: "src/graph/service.ts",
    kind: "file",
    parent: "src/graph",
    ord: 0,
    status: "fresh",
    file: "src/graph/service.ts",
    startLine: 1,
    endLine: 140,
  },
  {
    id: "src/graph/service.ts:GraphService",
    kind: "class",
    parent: "src/graph/service.ts",
    ord: 0,
    status: "fresh",
    file: "src/graph/service.ts",
    startLine: 23,
    endLine: 39,
  },
  {
    id: "src/graph/service.ts:layer",
    kind: "function",
    parent: "src/graph/service.ts",
    ord: 1,
    status: "stale",
    file: "src/graph/service.ts",
    startLine: 41,
    endLine: 133,
  },
  {
    id: "src/graph/store.ts",
    kind: "file",
    parent: "src/graph",
    ord: 1,
    status: "needs_review",
    file: "src/graph/store.ts",
    startLine: 1,
    endLine: 790,
  },
  {
    id: "tui",
    kind: "directory",
    parent: ".",
    ord: 1,
    status: "skeleton",
  },
  {
    id: "tui/graph.tsx",
    kind: "file",
    parent: "tui",
    ord: 0,
    status: "fresh",
    file: "tui/graph.tsx",
    startLine: 1,
    endLine: 260,
  },
]

const status: GraphInfo = {
  enabled: true,
  languages: ["c", "cpp", "python", "typescript", "rust"],
  ingest: {
    files: 8481,
    fileNodes: 8481,
    defNodes: 16117,
    regionNodes: 47439,
    callEdges: 229549,
    importEdges: 3702,
    extendsEdges: 59,
    implementsEdges: 4,
    parseFailed: 18,
  },
}

const working: GraphWorkingSetSnapshot = {
  rows: [
    { state: "pinned", id: "src/graph/service.ts", tokens: "13.6k", takeaway: "the location service + ingest gate", changed: false },
    { state: "open", id: "src/graph/service.ts:GraphService", tokens: "980", takeaway: "service surface", changed: true },
    { state: "stub", id: "src/graph/store.ts", tokens: "", takeaway: "stale after re-ingest", changed: false },
  ],
  totalTokens: 14600,
  capTokens: 32768,
  overBudget: false,
}

const journal: GraphTaskLedger = {
  id: "T1",
  status: "active",
  era: 2,
  definition: {
    goal: "Expose the graph to the TUI over HTTP and render the three panes",
    constraints: "read-only endpoints; no L3 block in tool results",
  },
  criteria: [
    { id: "C1", text: "graph.status reports ingest stats for the location", coveredBy: ["src/graph/service.ts"] },
    { id: "C2", text: "working-set peek never demotes entries", coveredBy: ["src/graph/working-set.ts"] },
  ],
  journal: [
    { seq: 1, era: 1, text: "defined task; rooted the tree at src/", at: 1760000000000 },
    { seq: 2, era: 1, text: "opened service.ts — layer shape matches vcs pattern", at: 1760000001000 },
    { seq: 3, era: 2, text: "rotation: re-derived node counts after re-ingest", at: 1760000002000 },
  ],
  scratch: [],
}

function GraphStory(props: { context: Plugin.Context }) {
  const dimensions = useTerminalDimensions()
  const theme = props.context.theme
  const [tick, setTick] = createSignal(0)
  // Cycle the fixture's stale/changed markers so the pane's feedback states are demonstrable.
  const fixtures = [treeRows, treeRows]
  const fixtureContext: Plugin.Context = {
    ...props.context,
    location: { directory: "/fixture" } as Plugin.Context["location"],
    client: {
      ...props.context.client,
      graph: {
        status: async () => ({ location: { directory: "/fixture" }, data: status }),
        tree: async () => ({ location: { directory: "/fixture" }, data: fixtures[tick() % fixtures.length]! }),
        workingSet: async () => ({ location: { directory: "/fixture" }, data: working }),
        journal: async () => ({ location: { directory: "/fixture" }, data: tick() % 2 ? null : journal }),
      },
    } as Plugin.Context["client"],
  }

  props.context.keymap.layer(() => ({
    commands: [
      {
        bind: "escape",
        title: "Back to storybook",
        group: "Storybook",
        run: () => props.context.ui.router.navigate({ type: "plugin", name: "storybook" }),
      },
      { bind: "f", title: "Toggle journal presence", group: "Storybook", run: () => setTick((n) => n + 1) },
    ],
  }))

  return (
    <box width={dimensions().width} height={dimensions().height} backgroundColor={theme.background.base}>
      <GraphViewer context={fixtureContext} sessionID="fixture-session" onClose={() => void 0} />
      <StoryFooter
        context={props.context}
        title="storybook / graph panes"
        details={[`${treeRows.length} fixture nodes`]}
        message="Pane keys (1/2/3, tab, ↑↓, ←→, r) come from the production GraphViewer"
        controls={[
          { shortcut: "1/2/3", label: "pane" },
          { shortcut: "f", label: "toggle journal" },
          { shortcut: "esc", label: "back" },
        ]}
      />
    </box>
  )
}

export const graphStory: Story = {
  id: "graph",
  title: "Graph panes",
  render: (context) => <GraphStory context={context} />,
}
