// What differs between the add-on tabs (Minecraft's Plugins/Mods, Datapacks,
// Modpacks and Resource Pack from Modrinth; tModLoader's Mods from the Steam
// Workshop). The shared browser (components/addons) draws
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

/** A project the user opened. */
export interface AddonTarget {
    projectId: string;
    slug: string;
    title: string;
    description: string;
    iconUrl?: string;
    /** the projects the catalog says this one requires, when it says */
    dependencies?: string[];
}

/** One search result. */
export interface AddonHit extends AddonTarget {
    /** the result card's footer, e.g. "1.2k downloads" */
    stat: string;
}

/** A project's page. */
export interface AddonProject {
    title: string;
    description: string;
    iconUrl?: string;
    /** markdown, drawn with PaperMarkdown */
    body: string;
    /** images in the body load; only for catalogs that review what they host */
    allowImages: boolean;
    /** the body's HTML is drawn as formatting rather than shown as source */
    allowHtml: boolean;
    /** the Information table */
    info: { label: string; value: string }[];
}

/** A line the source's terms require beside its results. */
export interface AddonNotice {
    text: string;
    link?: { label: string; href: string };
}

/** Where a kind's add-ons are found. */
export interface AddonSource {
    /** "Modrinth", for sentences */
    name: string;
    /** the catalog's browse page, linked under the search */
    url: string;
    /** the project page's link, "Open at Modrinth.com" */
    pageLabel: string;
    pageUrl(target: AddonTarget): string;
    project(target: AddonTarget): Promise<AddonProject>;
    /** attribution and disclaimers shown with results */
    notices?(): AddonNotice[];
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
    /** the project it came from; absent when added by hand or uploaded */
    project?: { projectId: string; slug: string };
    /** the version its source gave it */
    version?: string;
    /** added through the Upload action, so no catalog record describes it */
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

/** One way to bring files in from the user's disk. */
export interface AddonUploadSource {
    label: string;
    icon: string;
    /** asks the user for the files and copies them into `dir` in the panel's storage */
    pick(dir: string): Promise<{ status: "imported" | "canceled"; name?: string }>;
}

export interface AddonUpload {
    sources: AddonUploadSource[];
    /** the title over a failed upload */
    failureTitle: string;
    /** asks before adding what was picked, for an upload that replaces things */
    confirm?: { title: string; text: string; action: string };
    /** the upload cannot start, e.g. while the server runs */
    disabled?(): boolean;
    /** the service checks what `pick` staged and adds it; whatever it was, it clears the staging folder */
    commit(stage: string): Promise<unknown>;
    /** removes what `pick` staged when the upload ended before or inside `commit` */
    discard(stage: string): Promise<void>;
    /** the notice after a finished upload; null when the tab reports the outcome itself */
    describe(result: unknown): { title: string; message: string } | null;
}

export interface AddonKind<Meta = undefined> {
    /** the page header */
    title: string;
    icon: string;
    /** the avatar of a card without an icon */
    glyph: string;
    /** "plugin", for sentences */
    noun: string;
    source: AddonSource;
    searchPlaceholder: string;
    /** "Datapacks for Minecraft 1.21" — what the search covers, before "provided by <source>" */
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

    search(query: string, signal: AbortSignal): Promise<AddonHit[]>;
    versions(projectId: string): Promise<AddonVersion[]>;
    /** the build selected when the dialog opens; defaults to the recommended, else the first */
    pickVersion?(versions: AddonVersion[]): AddonVersion | undefined;

    /** a card opens its project page (with Install/Uninstall) instead of going straight to the dialog */
    detail?: boolean;
    /** what clicking an installed card does */
    itemClick: "detail" | "remove" | "none";
    itemActions?: AddonItemAction[];

    /** bring add-ons in from disk; absent when the server cannot use them (a resource pack is a URL) */
    upload?: AddonUpload;

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
