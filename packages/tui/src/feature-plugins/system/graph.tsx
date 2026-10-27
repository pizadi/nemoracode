/** @jsxImportSource @opentui/solid */
import type { GraphNodeRow } from "@nemoracode/client"
import { Plugin } from "@nemoracode/plugin/tui"

import { createMemo, createResource, createSignal, For, Match, Show, Switch } from "solid-js"
import { StoryFooter } from "./storybook/footer"

const ROUTE = "graph"
type Tab = "tree" | "working" | "journal"
const TABS: ReadonlyArray<{ readonly id: Tab; readonly label: string }> = [
  { id: "tree", label: "graph" },
  { id: "working", label: "working set" },
  { id: "journal", label: "journal" },
]

const statusGlyph: Record<GraphNodeRow["status"], string> = {
  skeleton: "○",
  fresh: "●",
  stale: "◐",
  needs_review: "◑",
  auto_generated: "◔",
  conflict: "✗",
}

export type TreeRow = { node: GraphNodeRow; depth: number; leaf: boolean; expanded: boolean }

/** Flattens the containment tree; subtrees collapse unless their container id is in `expanded`. */
export function flattenTree(nodes: ReadonlyArray<GraphNodeRow>, expanded: ReadonlySet<string>): Array<TreeRow> {
  const children = new Map<string, GraphNodeRow[]>()
  for (const node of nodes) {
    if (node.parent === undefined) continue
    const list = children.get(node.parent) ?? []
    list.push(node)
    children.set(node.parent, list)
  }
  for (const list of children.values()) list.sort((a, b) => a.ord - b.ord || a.id.localeCompare(b.id))
  const rows: Array<TreeRow> = []
  const walk = (parent: string, depth: number) => {
    for (const node of children.get(parent) ?? []) {
      const kids = children.get(node.id) ?? []
      rows.push({ node, depth, leaf: kids.length === 0, expanded: expanded.has(node.id) })
      if (kids.length > 0 && expanded.has(node.id)) walk(node.id, depth + 1)
    }
  }
  walk("", 0)
  return rows
}

/** The wire `definition` is Schema.Json; read a string field defensively. */
const jsonField = (definition: unknown, key: string): string | undefined => {
  if (typeof definition !== "object" || definition === null) return undefined
  const value = (definition as Record<string, unknown>)[key]
  return typeof value === "string" ? value : undefined
}

export function GraphViewer(props: { context: Plugin.Context; sessionID?: string; onClose: () => void }) {
  const theme = props.context.theme
  const location = () => props.context.location ?? props.context.data.location.default()
  const [tab, setTab] = createSignal<Tab>("tree")
  const [selected, setSelected] = createSignal(0)
  const [expanded, setExpanded] = createSignal<ReadonlySet<string>>(new Set(["."]))
  const [refresh, setRefresh] = createSignal(0)

  const [status] = createResource(
    () => [location(), refresh()] as const,
    async ([location]) =>
      await props.context.client.graph
        .status({ location })
        .then((result) => result.data)
        .catch(() => undefined),
  )
  const [tree] = createResource(
    () => [location(), refresh()] as const,
    async ([location]) =>
      await props.context.client.graph
        .tree({ location })
        .then((result) => result.data)
        .catch(() => undefined),
  )
  const [working] = createResource(
    () => [location(), props.sessionID, refresh()] as const,
    async ([location, session]) =>
      session
        ? await props.context.client.graph
            .workingSet({ location, session })
            .then((result) => result.data)
            .catch(() => null)
        : null,
  )
  const [journal] = createResource(
    () => [location(), refresh()] as const,
    async ([location]) =>
      await props.context.client.graph
        .journal({ location })
        .then((result) => result.data)
        .catch(() => null),
  )

  const rows = createMemo(() => flattenTree(tree() ?? [], expanded()))
  const move = (delta: number) => setSelected((current) => Math.max(0, Math.min(rows().length - 1, current + delta)))
  const refreshAll = () => {
    setRefresh((n) => n + 1)
    setSelected(0)
  }

  props.context.keymap.layer(() => ({
    commands: [
      { bind: "escape", title: "Close graph pane", group: "Graph", run: props.onClose },
      { bind: "1", title: "Graph pane", group: "Graph", run: () => setTab("tree") },
      { bind: "2", title: "Working set pane", group: "Graph", run: () => setTab("working") },
      { bind: "3", title: "Journal pane", group: "Graph", run: () => setTab("journal") },
      {
        bind: "tab",
        title: "Next graph pane",
        group: "Graph",
        run: () => setTab((current) => TABS[(TABS.findIndex((t) => t.id === current) + 1) % TABS.length].id),
      },
      { bind: "r", title: "Refresh graph panes", group: "Graph", run: refreshAll },
      { bind: "up,k", title: "Previous node", group: "Graph", enabled: tab() === "tree", run: () => move(-1) },
      { bind: "down,j", title: "Next node", group: "Graph", enabled: tab() === "tree", run: () => move(1) },
      {
        bind: "left",
        title: "Collapse node",
        group: "Graph",
        enabled: tab() === "tree",
        run() {
          const row = rows()[selected()]
          if (row && !row.leaf) setExpanded((set) => new Set([...set].filter((id) => id !== row.node.id)))
        },
      },
      {
        bind: "right,return",
        title: "Expand node",
        group: "Graph",
        enabled: tab() === "tree",
        run() {
          const row = rows()[selected()]
          if (row && !row.leaf) setExpanded((set) => new Set([...set, row.node.id]))
        },
      },
    ],
  }))

  const ingest = () => status()?.ingest
  const header = (right?: string) => (
    <box flexDirection="row" gap={2} flexShrink={0} paddingBottom={1}>
      <For each={TABS}>
        {(t, index) => (
          <text fg={tab() === t.id ? theme.text.base : theme.text.muted} onMouseUp={() => setTab(t.id)}>
            {index() + 1} {tab() === t.id ? "▸" : ""} {t.label}
          </text>
        )}
      </For>
      <box flexGrow={1} />
      <Show when={right}>
        <text fg={theme.text.muted}>{right}</text>
      </Show>
    </box>
  )

  const treeBody = (
    <Show
      when={(tree() ?? []).length > 0}
      fallback={<text fg={theme.text.muted}>empty — the tree agent ingests on first tool use</text>}
    >
      <For each={rows()}>
        {(row, index) => (
          <text
            fg={
              index() === selected()
                ? theme.text.formfield.selected
                : row.node.status === "skeleton"
                  ? theme.text.muted
                  : theme.text.base
            }
            wrapMode="none"
          >
            {index() === selected() ? "› " : "  "}
            <Show when={!row.leaf}>{row.expanded ? "▾ " : "▸ "}</Show>
            <Show when={row.leaf}>{"  "}</Show>
            <span>{"".padEnd(row.depth * 2)}</span>
            <span>
              {statusGlyph[row.node.status]} {row.node.id}
            </span>
            <Show when={row.node.file}>
              <span style={{ fg: theme.text.faint }}>
                {" "}
                {row.node.file}:{row.node.startLine}-{row.node.endLine}
              </span>
            </Show>
          </text>
        )}
      </For>
    </Show>
  )

  const workingBody = (
    <Switch>
      <Match when={props.sessionID === undefined}>
        <text fg={theme.text.muted}>open from a session to see its working set</text>
      </Match>
      <Match when={(working()?.rows.length ?? 0) === 0}>
        <text fg={theme.text.muted}>empty — nodes appear when the agent opens them</text>
      </Match>
      <Match when={true}>
        <For each={working()?.rows ?? []}>
          {(row) => (
            <text fg={row.changed ? theme.text.feedback.warning.base : theme.text.base} wrapMode="none">
              {row.state === "pinned" ? "⚑" : row.state === "open" ? "▸" : "○"} {row.id}
              <Show when={row.tokens}>
                <span style={{ fg: theme.text.faint }}> {row.tokens}tok</span>
              </Show>
              <Show when={row.changed}>
                <span style={{ fg: theme.text.feedback.warning.base }}> [changed — re-open]</span>
              </Show>
              <Show when={row.takeaway}>
                <span style={{ fg: theme.text.muted }}> — {row.takeaway}</span>
              </Show>
            </text>
          )}
        </For>
      </Match>
    </Switch>
  )

  const journalBody = (
    <Show when={journal()} fallback={<text fg={theme.text.muted}>no active task — define_task starts the ledger</text>}>
      {(ledger) => (
        <box flexDirection="column">
          <text fg={theme.text.base}>
            task {ledger().id} — {ledger().status} (era {ledger().era})
          </text>
          <Show when={jsonField(ledger().definition, "goal")}>
            {(goal) => <text fg={theme.text.base}>goal: {goal()}</text>}
          </Show>
          <Show when={ledger().criteria.length > 0}>
            <text fg={theme.text.muted}> ── acceptance criteria ──</text>
            <For each={ledger().criteria}>
              {(criterion) => (
                <text fg={theme.text.base} wrapMode="none">
                  {"  "}
                  {criterion.id}: {criterion.text}
                  <Show when={criterion.coveredBy.length > 0}>
                    <span style={{ fg: theme.text.faint }}> [{criterion.coveredBy.join(", ")}]</span>
                  </Show>
                </text>
              )}
            </For>
          </Show>
          <text fg={theme.text.muted}> ── journal ──</text>
          <Show when={ledger().journal.length > 0} fallback={<text fg={theme.text.muted}> (empty)</text>}>
            <For each={ledger().journal}>
              {(entry) => (
                <text fg={theme.text.base} wrapMode="none">
                  {"  "}#{entry.seq}{" "}
                  <Show when={entry.era !== ledger().era}>
                    <span style={{ fg: theme.text.faint }}>[era {entry.era}] </span>
                  </Show>
                  {entry.text}
                </text>
              )}
            </For>
          </Show>
        </box>
      )}
    </Show>
  )

  return (
    <box width="100%" height="100%" backgroundColor={theme.background.base} padding={1} flexDirection="column">
      <Show
        when={status()?.enabled !== false}
        fallback={
          <box flexDirection="column">
            {header()}
            <text fg={theme.text.muted}>graph disabled — enable config.graph to use the tree agent</text>
          </box>
        }
      >
        <Switch>
          <Match when={tab() === "tree"}>
            {header(ingest() ? `${ingest()!.fileNodes} files · ${ingest()!.defNodes} defs` : undefined)}
            {treeBody}
          </Match>
          <Match when={tab() === "working"}>
            {header(
              working()
                ? `${working()!.totalTokens} / ${working()!.capTokens} tokens${working()!.overBudget ? " — over budget" : ""}`
                : undefined,
            )}
            {workingBody}
          </Match>
          <Match when={true}>
            {header()}
            {journalBody}
          </Match>
        </Switch>
      </Show>
      <box flexGrow={1} />
      <StoryFooter
        context={props.context}
        title="graph"
        controls={[
          { shortcut: "1/2/3", label: "pane" },
          { shortcut: "↑↓", label: "select" },
          { shortcut: "←→", label: "collapse/expand" },
          { shortcut: "r", label: "refresh" },
          { shortcut: "esc", label: "close" },
        ]}
      />
    </box>
  )
}

function Commands(props: { context: Plugin.Context }) {
  props.context.keymap.layer(() => ({
    mode: "global",
    commands: [
      {
        id: "graph.open",
        title: "Open graph pane",
        slash: { name: "graph" },
        group: "Graph",
        palette: true,
        run() {
          props.context.ui.dialog.clear()
          const route = props.context.ui.router.current()
          props.context.ui.router.navigate({
            type: "plugin",
            name: ROUTE,
            data: { sessionID: route.type === "session" ? route.sessionID : undefined },
          })
        },
      },
    ],
  }))
  return null
}

export default Plugin.define({
  id: "nemoracode.graph",
  setup(context) {
    context.ui.router.register({
      name: ROUTE,
      render: ({ data }) => (
        <GraphViewer
          context={context}
          sessionID={data?.sessionID}
          onClose={() => context.ui.router.navigate({ type: "home" })}
        />
      ),
    })
    context.ui.slot({ append: "app", render: () => <Commands context={context} /> })
  },
})
