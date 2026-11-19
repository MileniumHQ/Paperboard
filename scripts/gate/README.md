# The gate

`bun run gate [target...]` runs a part's checks: tests, typechecks, lint, and the house rules. With no target it runs everything. `gate.sh` lists the targets.

## What a pull request runs

A pull request runs only the targets its changes can reach. `scope.ts` works them out, and CI turns them into jobs. A push to `main` still runs the whole gate.

```sh
bun scripts/gate/scope.ts               # the targets this branch reaches
bun scripts/gate/scope.ts --why terminal # why it reaches one
```

```
terminal runs because:
  scripts/build/targets.ts changed
  which scripts/build/supervisor.ts uses
  which panels/dev.paperboard.terminal uses
```

### How it decides

- **Every target owns a folder.** A changed file reruns its owner. Panels are found in `panels/` on their own; any other part is listed in `TARGET_DIRS`.
- **Parts use each other** through a workspace dependency in `package.json`, or a path written in a string: `"../x"`, `"apps/daemon/src/main.ts"` or `"apps", "daemon", "src"`. A path only counts if it exists.
- **Both sides count.** The graph is read from the branch and from the `main` it left, so deleting or moving a file still reruns the parts that used it.
- **Tests stay home.** A part's tests, fixtures, scripts and configs are its own. Changing them reruns only that part (plus another part whose tests point at that exact file).
- **Each file in `scripts/` counts on its own**, so using one script doesn't tie you to all of them.
- **Some files rerun everything:** `bun.lock`, the root `package.json`, `scripts/gate/` and the gate workflow.
- **Files no target owns** (the root's markdown, `branding/`) rerun only `global`.

## When you change the layout

- **A new part outside `panels/`:** add it to `TARGET_DIRS` in `scope.ts` and to `gate.sh`. The scope test fails until both lists match.
- **Keep shared files small.** Importing one value from a big file ties you to everything that file imports. A PR that runs far more than it should usually means one of these, and `--why` will show which.
- **Use a path the graph can see.** A path built at runtime, a glob or an env var is invisible to it, so a pull request can skip a target it breaks. Write the path out in a string, or import it.
