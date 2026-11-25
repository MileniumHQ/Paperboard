// The registry a setup downloads Paperboard Server from, under the policy
// the updater and the daemon share (resolveRegistryUrl): an override is
// honored only outside a packaged app. Needs Electron, so it is imported
// only when a setup installs.
import { is } from "@electron-toolkit/utils";
import { resolveRegistryUrl } from "daemon/core/util";

export const registryUrl = (): string =>
    resolveRegistryUrl({ nodeEnv: is.dev ? "development" : "production", env: process.env, argv: process.argv });
