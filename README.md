<p align="center">
  <a href="https://github.com/pizadi/nemoracode">
    <picture>
      <source srcset="packages/console/app/src/asset/logo-ornate-dark.svg" media="(prefers-color-scheme: dark)">
      <source srcset="packages/console/app/src/asset/logo-ornate-light.svg" media="(prefers-color-scheme: light)">
      <img src="packages/console/app/src/asset/logo-ornate-light.svg" alt="NemoraCode logo">
    </picture>
  </a>
</p>
<p align="center">A graph-based AI coding agent, built into OpenCode.</p>
<p align="center">NemoraCode is a fork of <a href="https://github.com/anomalyco/opencode">OpenCode</a> that adds the graph-addressed coding agent from <code>nemora</code> as a first-class <b>tree</b> agent.</p>
<p align="center">
  <a href="https://www.npmjs.com/package/@nemoracode/cli"><img alt="npm" src="https://img.shields.io/npm/v/@nemoracode/cli?style=flat-square" /></a>
</p>

![NemoraCode Terminal UI](packages/web/src/assets/lander/screenshot.png)

---

### What is this?

[OpenCode](https://github.com/anomalyco/opencode) is an open source AI coding agent. It reads and edits files in your project through a transcript of the whole conversation. `nemora` is a separate, standalone C++ TUI agent that instead gives the model a **code graph** of the project (files, definitions, typed edges) and has it walk and edit that graph rather than raw files.

NemoraCode merges the two: everything OpenCode provides (TUI, desktop and web apps, server, providers, plugins) plus a **tree** agent that works on the graph. It is not affiliated with the upstream OpenCode team.

### Installation

NemoraCode has no packaged releases yet. Install from source (requires [Bun](https://bun.sh); the exact version is pinned by `packageManager` in `package.json`):

```bash
git clone https://github.com/pizadi/nemoracode.git
cd nemoracode
bun install
bun run dev
```

Other entry points: `bun run dev:web` (web app), `bun run dev:desktop` (desktop app), `bun run dev:storybook`.

### Agents

NemoraCode includes three built-in primary agents you can switch between with the `Tab` key.

- **build** - Default, full-access agent for development work
- **plan** - Read-only agent for analysis and code exploration
  - Denies file edits by default
  - Asks permission before running bash commands
  - Ideal for exploring unfamiliar codebases or planning changes
- **tree** - Graph-based agent from `nemora`, see below

Also included is a **general** subagent for complex searches and multistep tasks.
This is used internally and can be invoked using `@general` in messages.

**build**, **plan** and **general** are inherited from OpenCode; see the [upstream agents docs](https://opencode.ai/v2/docs/agents).

### Tree agent

The **tree** agent comes from `nemora` and is what this fork adds on top of OpenCode. Instead of reading and editing raw files, it works on a per-project code graph: the project is ingested into nodes (files and definitions) connected by typed edges and stored in `.nemoracode/graph.db`. Ingest uses tree-sitter for C, C++, Python, TypeScript/TSX and Rust, with a fallback for other text files.

- **Graph tools** - `search_graph` finds nodes by descriptor, `inspect` reads a node at three tiers (stub / contract / body), `neighbors` walks its edges
- **Graph-only writes** - `edit_node` is the only way to modify code and file edit tools are blocked; signatures and declared inputs/outputs are frozen, so contract changes are rejected
- **Bounded working set** - `open_node` loads a body into the working set rendered at the end of every turn, `close_node` demotes it back to a stub with a one-line takeaway; bodies never enter the transcript
- **Staged workflow** - `set_stage` gates the work: skeleton (design with skeleton nodes) → validate (structural checks) → slice (the thinnest end-to-end path) → fill (unrestricted body edits)
- **Journal** - `define_task` and `journal_append` record decisions and progress ahead of the transcript and survive context rotation
- **Subtree subagents** - `spawn_subtree` hands a locked subtree to a **tree-sub** subagent that reports back to the parent

View the graph, working set, and journal in the TUI with the `/graph` command. The same data is served over the `/api/graph*` endpoints.

### Documentation

NemoraCode has no docs site of its own yet. Configuration, providers, plugins and the non-graph agents behave as in OpenCode, so the [upstream OpenCode docs](https://opencode.ai/v2/docs) apply, except where this README says otherwise.

### Contributing

If you're interested in contributing to NemoraCode, please read our [contributing docs](./CONTRIBUTING.md) before submitting a pull request.

### Building on NemoraCode

If you are working on a project that's related to NemoraCode and is using "nemoracode" as part of its name, for example "nemoracode-dashboard" or "nemoracode-mobile", please add a note to your README to clarify that it is not built by the NemoraCode team and is not affiliated with us in any way.

