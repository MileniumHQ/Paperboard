import { createEffect, createMemo, createSignal, For, Show, untrack, type JSX } from "solid-js";
import {
    PaperAvatar,
    PaperButton,
    PaperEffect,
    PaperFlex,
    PaperIcon,
    PaperLink,
    PaperMarkdown,
    PaperModal,
    PaperSlidePage,
    PaperTable,
    PaperText,
    usePaperPanel,
} from "@mileniumhq/paperui";
import type { AddonKind, AddonProject, AddonTarget, InstalledAddon } from "../../lib/addons/kind";
import type { DetailTarget } from "./state";

/** What a kind adds to its project page: buttons beside Uninstall, and a notice under the header. */
export type DetailExtras = (entry: InstalledAddon, close: () => void) => { actions: JSX.Element; notice: JSX.Element };

const truncate = (text: string, max: number) => (text.length > max ? `${text.slice(0, max).trimEnd()}…` : text);

/** A catalog project's page, with Install, or Uninstall and a kind's own buttons once it is installed. */
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
    const [project, setProject] = createSignal<AddonProject | null>(null);
    const [loading, setLoading] = createSignal(false);
    const [loadError, setLoadError] = createSignal<string | null>(null);

    // what the page shows stays set while it closes, so it doesn't change under its exit
    const [kept, setKept] = createSignal<DetailTarget | null>(null);
    const [keptEntry, setKeptEntry] = createSignal<InstalledAddon | null>(null);
    createEffect(() => {
        if (!props.target) return;
        setKept(props.target);
        setKeptEntry(props.entry);
    });
    const entry = () => (props.target ? props.entry : keptEntry());
    // a phone shows the page over the list; a modal takes no back swipe
    const panel = usePaperPanel();
    const compact = () => Boolean(panel?.compact?.());

    createEffect(() => {
        const target = props.target;
        if (!target) return;
        setProject(null);
        setLoading(false);
        setLoadError(null);
        if (target.local) return;
        setLoading(true);
        props.kind.source
            .project(target)
            .then((next) => {
                if (props.target?.projectId === target.projectId) setProject(next);
            })
            .catch((err) => {
                // the page still shows what the list knows, and says why the rest is missing
                console.error(`[${props.kind.title}] Failed to load project details:`, err);
                if (props.target?.projectId === target.projectId) setLoadError(err instanceof Error ? err.message : String(err));
            })
            .finally(() => setLoading(false));
    });

    const page = (target: DetailTarget) => {
            // made once per entry: both pieces share the state the kind creates
            const entryId = createMemo(() => entry()?.id);
            const extras = createMemo(() =>
                entryId() && entry() && props.extras ? untrack(() => props.extras!(entry()!, props.onClose)) : null,
            );
            return (
                <PaperFlex direction="column" gap="full">
                    <PaperFlex direction="row" gap="full" align="center" wrap>
                        <PaperAvatar
                            src={project()?.iconUrl ?? target.iconUrl}
                            shape="square"
                            size="large"
                            fallbackIcon={props.kind.glyph}
                        />
                        <PaperFlex direction="column" gap="onefourth" flex minWidth="field">
                            <Show when={!target.local}>
                                <PaperLink href={props.kind.source.pageUrl(target)} target="_blank">
                                    {props.kind.source.pageLabel}
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
                            when={entry()}
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
                                        ? `You uploaded this file. ${props.kind.source.name} has no record of it, so there are no details or updates to show.`
                                        : `This file was added outside Paperboard. ${props.kind.source.name} has no record of it, so there are no details or updates to show.`}
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
                                        Loading details from {props.kind.source.name}...
                                    </PaperText>
                                }
                            >
                                <Show
                                    when={project()?.body}
                                    fallback={
                                        <PaperText size={2} color={loadError() ? "danger" : "text-subtle"}>
                                            {loadError() ? `Couldn't load details: ${loadError()}` : "No description provided."}
                                        </PaperText>
                                    }
                                >
                                    {/* Third-party markdown goes through PaperMarkdown, which renders PaperUI
                                        elements instead of HTML; the source says whether its images may load. */}
                                    <PaperMarkdown text={project()!.body} allowImages={project()!.allowImages} allowHtml={project()!.allowHtml} />
                                </Show>
                            </Show>
                        </PaperFlex>

                        <PaperFlex direction="column" gap="onefourth">
                            <PaperText size={3} weight={700}>
                                Information
                            </PaperText>
                            <PaperTable>
                                <tbody>
                                    <For each={project()?.info ?? []}>
                                        {(row) => (
                                            <tr>
                                                <th>{row.label}</th>
                                                <td>{row.value}</td>
                                            </tr>
                                        )}
                                    </For>
                                    <tr>
                                        <th>Installed Version</th>
                                        <td>
                                            {entry()?.version
                                                ? `v${entry()!.version}`
                                                : entry()
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
    };

    return (
        <>
            <Show when={!compact()}>
                <PaperModal open={props.target !== null} onClose={props.onClose} size="large" noHeader>
                    <Show when={kept()} keyed>
                        {page}
                    </Show>
                </PaperModal>
            </Show>
            <PaperSlidePage position="fixed" enabled={compact()} open={props.target !== null} title={kept()?.title ?? ""} onBack={props.onClose}>
                <Show when={compact() && kept()} keyed>
                    {(target) => (
                        <PaperFlex direction="column" padding="full" scrollable="y" fullHeight>
                            {page(target)}
                        </PaperFlex>
                    )}
                </Show>
            </PaperSlidePage>
        </>
    );
}
