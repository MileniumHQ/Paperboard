import { createEffect, createMemo, createSignal, Show, untrack, type JSX } from "solid-js";
import {
    PaperAvatar,
    PaperButton,
    PaperEffect,
    PaperFlex,
    PaperIcon,
    PaperLink,
    PaperMarkdown,
    PaperModal,
    PaperTable,
    PaperText,
} from "@mileniumhq/paperui";
import { getProject, type ModrinthProject } from "../../lib/modrinth";
import type { AddonKind, AddonTarget, InstalledAddon } from "../../lib/addons/kind";
import type { DetailTarget } from "./state";
import { formatCount } from "../../lib/addons/presentation";

/** What a kind adds to its project page: buttons beside Uninstall, and a notice under the header. */
export type DetailExtras = (entry: InstalledAddon, close: () => void) => { actions: JSX.Element; notice: JSX.Element };

function formatDate(iso: string): string {
    const date = new Date(iso);
    if (!iso || Number.isNaN(date.getTime())) return "Unknown";
    return date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

const truncate = (text: string, max: number) => (text.length > max ? `${text.slice(0, max).trimEnd()}…` : text);

/** A Modrinth project's page, with Install, or Uninstall and a kind's own buttons once it is installed. */
export function AddonDetail<Meta>(props: {
    kind: AddonKind<Meta>;
    target: DetailTarget | null;
    /** the installed entry the target is, if any */
    entry: InstalledAddon | null;
    busy: boolean;
    extras?: DetailExtras;
    onClose(): void;
    onInstall(target: AddonTarget): void;
    onRemove(entry: InstalledAddon): void;
}) {
    const [project, setProject] = createSignal<ModrinthProject | null>(null);
    const [loading, setLoading] = createSignal(false);

    createEffect(() => {
        const target = props.target;
        setProject(null);
        setLoading(false);
        if (!target || target.local) return;
        setLoading(true);
        getProject(target.projectId)
            .then((next) => {
                if (props.target?.projectId === target.projectId) setProject(next);
            })
            .catch((err) => {
                // the page still shows what the list knows; the failure is not the user's to fix
                console.error(`[${props.kind.title}] Failed to load project details:`, err);
            })
            .finally(() => setLoading(false));
    });

    return (
        <PaperModal open={props.target !== null} onClose={props.onClose} size="large" noHeader>
            <Show when={props.target} keyed>
                {(target) => {
                    // made once per entry: both pieces share the state the kind creates
                    const entryId = createMemo(() => props.entry?.id);
                    const extras = createMemo(() =>
                        entryId() && props.entry && props.extras ? untrack(() => props.extras!(props.entry!, props.onClose)) : null,
                    );
                    return (
                        <PaperFlex direction="column" gap="full">
                            <PaperFlex direction="row" gap="full" align="center">
                                <PaperAvatar
                                    src={project()?.iconUrl ?? target.iconUrl}
                                    shape="square"
                                    size="large"
                                    fallbackIcon={props.kind.glyph}
                                />
                                <PaperFlex direction="column" gap="onefourth" flex minWidth={0}>
                                    <Show when={!target.local}>
                                        <PaperLink href={`https://modrinth.com/${props.kind.modrinthPath}/${target.slug}`}>
                                            Open at Modrinth.com
                                        </PaperLink>
                                    </Show>
                                    <PaperText size={5} weight={700}>
                                        {project()?.title ?? target.title}
                                    </PaperText>
                                    <PaperText size={2} color="text-subtle">
                                        {truncate(target.description || project()?.description || "", 200)}
                                    </PaperText>
                                </PaperFlex>
                                <Show
                                    when={props.entry}
                                    keyed
                                    fallback={
                                        <PaperEffect variant="success">
                                            <PaperButton variant="success" disabled={props.busy} onClick={() => props.onInstall(target)}>
                                                <PaperIcon>{props.busy ? "hourglass_top" : "download"}</PaperIcon>
                                                Install
                                            </PaperButton>
                                        </PaperEffect>
                                    }
                                >
                                    {(entry) => (
                                        <PaperFlex direction="row" gap="half">
                                            {extras()?.actions}
                                            <PaperEffect variant="danger">
                                                <PaperButton variant="danger" disabled={props.busy} onClick={() => props.onRemove(entry)}>
                                                    <PaperIcon>delete</PaperIcon>
                                                    Uninstall
                                                </PaperButton>
                                            </PaperEffect>
                                        </PaperFlex>
                                    )}
                                </Show>
                            </PaperFlex>

                            {extras()?.notice}

                            <Show
                                when={!target.local}
                                fallback={
                                    <PaperFlex direction="column" gap="onefourth">
                                        <PaperText size={3} weight={700}>
                                            About
                                        </PaperText>
                                        <PaperText size={2} color="text-subtle">
                                            {target.local?.uploaded
                                                ? "You uploaded this file. Modrinth has no record of it, so there are no details or updates to show."
                                                : "This file was added outside Paperboard. Modrinth has no record of it, so there are no details or updates to show."}
                                        </PaperText>
                                    </PaperFlex>
                                }
                            >
                                <PaperFlex direction="column" gap="onefourth">
                                    <PaperText size={3} weight={700}>
                                        About
                                    </PaperText>
                                    <Show
                                        when={!loading()}
                                        fallback={
                                            <PaperText size={2} color="text-subtle">
                                                Loading details from Modrinth...
                                            </PaperText>
                                        }
                                    >
                                        <Show
                                            when={project()?.body}
                                            fallback={
                                                <PaperText size={2} color="text-subtle">
                                                    No description provided.
                                                </PaperText>
                                            }
                                        >
                                            {/* Third-party markdown goes through PaperMarkdown, which renders PaperUI
                                                elements instead of HTML; images are allowed because Modrinth bodies are
                                                reviewed, host-scoped by the panel manifest and CSP-enforced. */}
                                            <PaperMarkdown text={project()!.body} allowImages />
                                        </Show>
                                    </Show>
                                </PaperFlex>

                                <PaperFlex direction="column" gap="onefourth">
                                    <PaperText size={3} weight={700}>
                                        Information
                                    </PaperText>
                                    <PaperTable>
                                        <tbody>
                                            <tr>
                                                <th>Downloads</th>
                                                <td>{formatCount(project()?.downloads ?? 0)}</td>
                                            </tr>
                                            <tr>
                                                <th>Follows</th>
                                                <td>{formatCount(project()?.follows ?? 0)}</td>
                                            </tr>
                                            <tr>
                                                <th>Last Updated</th>
                                                <td>{formatDate(project()?.dateModified ?? "")}</td>
                                            </tr>
                                            <tr>
                                                <th>License</th>
                                                <td>{project()?.license ?? "Unknown"}</td>
                                            </tr>
                                            <tr>
                                                <th>Loaders</th>
                                                <td>
                                                    {project()?.loaders.length
                                                        ? project()!
                                                              .loaders.map((l) => l.charAt(0).toUpperCase() + l.slice(1))
                                                              .join(", ")
                                                        : "Unknown"}
                                                </td>
                                            </tr>
                                            <tr>
                                                <th>Installed Version</th>
                                                <td>
                                                    {props.entry?.version
                                                        ? `v${props.entry.version}`
                                                        : props.entry
                                                          ? "Unknown (installed outside Paperboard)"
                                                          : "Not installed"}
                                                </td>
                                            </tr>
                                        </tbody>
                                    </PaperTable>
                                </PaperFlex>
                            </Show>
                        </PaperFlex>
                    );
                }}
            </Show>
        </PaperModal>
    );
}
