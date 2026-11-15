// What a Paperboard release is. The daemon installs releases, the app
// updates itself and its packages, the launcher (npx @mileniumhq/paperboard)
// fetches the daemon, and Origami's operator scripts publish them; all of
// them agree here on how a release is signed, how a vendor's build becomes a
// package, and which version is newer.
export * from "./signature";
export * from "./recipe";
export * from "./version";
