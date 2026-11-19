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
- **Parts use each other** through a workspace package they import, or a path: `"../x"`, `"apps/daemon/src/main.ts"`, `"apps", "daemon", "src"`, or a `join()` from the repo root. A join follows the constants that name its parts, here or imported (`REPO_DIR`, `const PANEL = "dev.paperboard.botcreator"`). A path only counts if it exists.
- **A join that goes on with something unknown** (a loop over panel ids) reaches everything under the folder it got to: `join(REPO_DIR, "panels", id)` reaches every panel. A join from a folder that isn't the repo (a data or temp folder) is no reference.
- **A package is public or private by who imports it.** Imported from a part's shipped code, its changes go on to that part's consumers, whichever list in `package.json` names it. Imported only from tests, or from no file, it reruns only that part.
- **Both sides count.** The graph is read from the branch and from the `main` it left, so deleting or moving a file still reruns the parts that used it.
- **Tests stay home.** A part's tests, fixtures, scripts and configs are its own. Changing them reruns only that part (plus another part whose tests point at that exact file, or at its folder).
- **The cross-platform runners start only when a change reaches a `test/platform` suite:** the part's own code, or what the suite points at. The app's boot test builds every panel from `panels/`, so any panel change starts them, its README included.
- **Each file in `scripts/` counts on its own**, so using one script doesn't tie you to all of them.
- **Some files rerun everything:** `bun.lock`, the root `package.json`, `scripts/gate/` and the gate workflow.
- **Files no target owns** (the root's markdown, `branding/`) rerun only `global`.

## When you change the layout

- **A new part outside `panels/`:** add it to `TARGET_DIRS` in `scope.ts` and to `gate.sh`. The scope test fails until both lists match.
- **Keep shared files small.** Importing one value from a big file ties you to everything that file imports. A PR that runs far more than it should usually means one of these, and `--why` will show which.
- **Use a path the graph can see.** A path from `process.cwd()`, a glob or an env var is invisible to it, so a pull request can skip a target it breaks. Join it from a constant that names the repo root (`REPO_DIR`), with the rest written out or in constants.
