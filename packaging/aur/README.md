# AUR preparation (nothing published)

The binary packages are `paperboard-bin` and `papercrane-bin`. They provide
`paperboard` and `papercrane` respectively. Source packages, if maintained in
future, can use those unsuffixed names. AUR requires `-bin` when source is
available: https://wiki.archlinux.org/title/AUR_submission_guidelines

The desktop package extracts the AppImage at build time and installs its
bundled Electron under `/opt/paperboard`. It needs no FUSE at runtime, and
Paperboard's existing package-manager update UI handles the extracted app.
The daemon package installs the compiled Paperboard server daemon under
`/usr/lib/papercrane`, with a `/usr/bin/papercrane` launcher that explicitly
refuses daemon self-updates. Update both packages through pacman/AUR tooling.

## Prepare release recipes

1. Run `bun scripts/publish.ts` and select **Build binaries** (local only).
   Select both Linux architectures for both products. The build stages the
   canonical AppImages and daemon tarballs in `apps/paperboard/dist/release/`.
2. Run:
   ```sh
   bun scripts/publish.ts aur \
     --assets apps/paperboard/dist/release \
     --output /tmp/paperboard-aur
   ```
   This reads the app version, hashes the four exact artifacts, copies license
   and integration files, and runs `makepkg --printsrcinfo`. It requires Arch's
   `makepkg` on PATH. It does not authenticate, upload, commit, or push.
   Output must be a new directory. Use `--pkgrel 2` for packaging-only revisions.
3. Review the generated `PKGBUILD` and `.SRCINFO` in each package directory.
   Test with `makepkg` in a clean Arch build environment for each architecture.
   The versioned GitHub release URLs must exist before recipes can be submitted;
   unpublished release bytes can be placed in makepkg's source cache under the
   version-prefixed source aliases for local validation.

No `SKIP` checksums or latest aliases are emitted. A prerelease dash becomes
an underscore in `pkgver`, while the upstream release URL retains the dash.
Never prepare against stale artifacts from another version: this command hashes
local bytes, and cannot assert that an unpublished GitHub release hosts them.

## Paperboard server daemon

After installation, opt in to startup with:

```sh
systemctl --user enable --now papercrane.service
```

The service runs as the current user, retains normal per-user data, and does
not disable authentication. It is not enabled automatically. Pair using the
Paperboard UI; for interactive pairing, stop the service and run
`papercrane --start-pairing` in a terminal. Stop that process before restarting
the user service. To start at boot without login, the administrator can enable
lingering for that user. Uninstalling the package retains user data.

Publication remains a separate, manual action after release and package
validation. `publish.ts` intentionally has no AUR push operation. This keeps
GitHub artifact publication and AUR recipe publication independently reviewable.
