import type { ModrinthHit } from "../modrinth";

// What differs between the Modrinth add-on tabs (Plugins/Mods, Datapacks,
// Modpacks, Resource Pack). The shared browser (components/addons) draws
// the search, the results, the installed list and the install and remove
// dialogs from one of these; a descriptor holds no JSX, so what it decides
// is testable without a page.

/** One build of a project the install dialog offers. */
export interface AddonVersion {
    id: string;
    label: string;
    recommended?: boolean;
    /** Minecraft versions the build targets */
    gameVersions?: string[];
}

/** A Modrinth project the user opened. */
export interface AddonTarget {
    projectId: string;
    slug: string;
    title: string;
    description: string;
    iconUrl?: string;
}

/** One entry of the installed list: a file or folder Paperboard can name. */
export interface InstalledAddon {
    /** what `remove.run` receives: the entry's file or folder name */
    id: string;
    title: string;
    /** the entry's file name or address */
    subtitle: string;
    iconUrl?: string;
    badge: { label: string; variant: "success" | "monochrome" | "warning" };
    footer: string;
    /** the Modrinth project it came from; absent when added by hand or uploaded */
    project?: { projectId: string; slug: string };
    /** the version Modrinth gave it */
    version?: string;
    /** added through the Upload action, so no Modrinth record describes it */
    uploaded: boolean;
}

export interface AddonListing<Meta = undefined> {
    items: InstalledAddon[];
    /** the folder could be read but not fully listed */
    warning?: { title: string; message: string };
    /** a line under the list's title, e.g. that it was cut short */
    note?: string;
    /** what the kind knows beyond the list: the world, the pack record, the properties */
    meta: Meta;
}

/** A button on an installed entry. */
export interface AddonItemAction {
    label: string;
    icon: string;
    /** opens the version dialog for the entry's project, or the remove confirmation */
    does: "install" | "remove";
    variant?: "danger";
    disabled?(): boolean;
}

export interface AddonKind<Meta = undefined> {
    /** the page header */
    title: string;
    icon: string;
    /** the avatar of a card without an icon */
    glyph: string;
    /** "plugin", for sentences */
    noun: string;
    /** Modrinth's address segment: modrinth.com/<path>/<slug> */
    modrinthPath: string;
    /** Modrinth's browse page for this type */
    browseUrl: string;
    searchPlaceholder: string;
    /** "Datapacks for Minecraft 1.21" — what the search covers, before "provided by Modrinth" */
    searchScope(): string;
    emptySearch(): string;
    installedTitle: string;
    /** the badge on a result the server already has */
    resultBadge: string;
    /** reactive state that changes what exists or is listed, e.g. the Minecraft version */
    watch?(): unknown;

    list(): Promise<AddonListing<Meta>>;
    /** the title over a listing failure */
    listFailureTitle(): string;
    /** a way out of a listing failure that the kind offers, e.g. forgetting a record it cannot read */
    recover?: { label: string; errorTitle: string; disabled?(): boolean; run(): Promise<void> };

    search(query: string, signal: AbortSignal): Promise<ModrinthHit[]>;
    versions(projectId: string): Promise<AddonVersion[]>;
    /** the build selected when the dialog opens; defaults to the recommended, else the first */
    pickVersion?(versions: AddonVersion[]): AddonVersion | undefined;

    /** a card opens its project page (with Install/Uninstall) instead of going straight to the dialog */
    detail?: boolean;
    /** what clicking an installed card does */
    itemClick: "detail" | "remove" | "none";
    itemActions?: AddonItemAction[];

    install: {
        title(target: AddonTarget): string;
        action: string;
        busyAction: string;
        icon: string;
        errorTitle: string;
        noVersions(): { title: string; text: string };
        /** the dialog cannot be confirmed, e.g. while the server runs */
        disabled?(): boolean;
        /** `payload` is what the kind's dialog extras reported */
        run(target: AddonTarget, versionId: string, payload: unknown): Promise<unknown>;
    };

    remove: {
        title(item: InstalledAddon): string;
        action: string;
        busyAction: string;
        errorTitle: string;
        describe(item: InstalledAddon, listing: AddonListing<Meta> | null): string;
        disabled?(): boolean;
        run(item: InstalledAddon): Promise<void>;
    };
}

/** The version a dialog opens on. */
export function defaultVersion(kind: Pick<AddonKind<unknown>, "pickVersion">, versions: AddonVersion[]): AddonVersion | undefined {
    return kind.pickVersion?.(versions) ?? versions.find((v) => v.recommended) ?? versions[0];
}
