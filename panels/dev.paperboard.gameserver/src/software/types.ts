import type { ServerSoftwareType } from "./catalog";
import type { InstallerLaunchCandidates } from "./launch";

export interface VersionItem {
    id: string;
    type: "release" | "snapshot";
    releaseTime?: string;
    // false when the picker must not offer this version — either the source
    // has no server build or the version is below Paperboard's supported floor
    installable: boolean;
}

/** One file to download, with the digest its publisher states for it. */
export interface ArtifactDownload {
    url: string;
    sha1?: string;
    sha256?: string;
}

export interface ResolvedBuild {
    /**
     * The software's own build or loader version for this Minecraft
     * version ("21.1.256", "52.1.0", Paper build 130). Null when the
     * software ships exactly one server per Minecraft version (vanilla).
     */
    build: string | null;
    artifact: ArtifactDownload;
}

/**
 * How the downloaded artifact becomes a runnable server.
 *
 *   jar        the artifact is the server; it is installed as server.jar
 *   installer  the artifact is an installer jar run with java into an
 *              empty folder; the launch entry point is read from its output
 */
export type InstallPlan =
    | { type: "jar" }
    | {
          type: "installer";
          /** java argv after the binary: installer jar path and output folder are absolute */
          args(installerJar: string, outputDir: string): string[];
          launchCandidates(mcVersion: string, build: string): InstallerLaunchCandidates;
      };

/** The network and install half of a software; static facts live in catalog.ts. */
export interface SoftwareProvider {
    id: ServerSoftwareType;
    /** Minecraft versions this software can run, newest first */
    listVersions(): Promise<VersionItem[]>;
    /** the build to install for a Minecraft version; throws when there is none */
    resolveBuild(mcVersion: string): Promise<ResolvedBuild>;
    install: InstallPlan;
}
