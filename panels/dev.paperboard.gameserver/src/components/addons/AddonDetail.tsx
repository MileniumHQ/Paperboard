import { createEffect, createMemo, createSignal, For, Show, untrack, type JSX, on, batch } from "solid-js";
import {
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
    type MarkdownImage,
} from "@mileniumhq/paperui";
import type { AddonKind, AddonProject, AddonTarget, InstalledAddon } from "../../lib/addons/kind";
import type { DetailTarget } from "./state";
import { createLatest } from "../../core/state";
import { errorMessage } from "../../lib/failure";
import { createServedPicture } from "../../lib/pictures";
import PictureAvatar from "../PictureAvatar";

/** What a kind adds to its project page: buttons beside Uninstall, and a notice under the header. */
export type DetailExtras = (entry: InstalledAddon, close: () => void) => { actions: JSX.Element; notice: JSX.Element };

const truncate = (text: string, max: number) => (text.length > max ? `${text.slice(0, max).trimEnd()}…` : text);

/**
 * An image in a project's page, fetched by the service from wherever its
 * author put it; its alt text stands in while it loads, and for an address
 * that isn't on the web. One that fails says why where it would be.
 */
function BodyPicture(props: { image: MarkdownImage }) {
    const address = () => (/^https?:\/\//i.test(props.image.src) ? props.image.src : null);
    const picture = createServedPicture(() => "web", address);
    return (
        <Show
            when={picture.src()}
            fallback={
                <Show when={picture.error()} fallback={<PaperText as="span" color="text-subtle">{props.image.alt}</PaperText>}>
                    <PaperText as="span" size={1} color="danger">
                        {props.image.alt ? `${props.image.alt}: ` : ""}The picture couldn't be loaded: {picture.error()}
                    </PaperText>
                </Show>
            }
        >
            <img src={picture.src()} alt={props.image.alt} title={props.image.title ?? undefined} />
        </Show>
    );
}

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
    createEffect(
        on([() => props.target, () => props.entry], ([target, shownEntry]) => {
            if (!target) return;
            setKept(target);
            setKeptEntry(shownEntry);
        }),
    );
    const entry = () => (props.target ? props.entry : keptEntry());
    // a phone shows the page over the list; a modal takes no back swipe
    const panel = usePaperPanel();
    const compact = () => Boolean(panel?.compact?.());

    // only the newest look-up speaks: an earlier project's answer, or its
    // end, never lands on the one opened after it
    const latest = createLatest();
    createEffect(
        on(
            () => props.target,
            (target) => {
                if (!target) return;
                setProject(null);
                setLoadError(null);
                // an add-on on disk has nothing to look up, and still replaces the look-up before it
                setLoading(!target.local);
                latest(async () => (target.local ? null : props.kind.source.project(target))).then(
                    (answer) => {
                        if (!answer) return;
                        batch(() => {
                            setProject(answer.value);
                            setLoading(false);
                        });
                    },
                    (err) => {
                        // the page still shows what the list knows, and says why the rest is missing
                        console.error(`[${props.kind.title}] Failed to load project details:`, err);
                        batch(() => {
                            setLoadError(errorMessage(err));
                            setLoading(false);
                        });
                    },
                );
            },
        ),
    );

    const page = (target: DetailTarget) => {
            // made once per entry: both pieces share the state the kind creates
            const entryId = createMemo(() => entry()?.id);
            const extras = createMemo(() =>
                entryId() && entry() && props.extras ? untrack(() => props.extras!(entry()!, props.onClose)) : null,
            );
            return (
                <PaperFlex direction="column" gap="full">
                    <PaperFlex direction="row" gap="full" align="center" wrap>
                        <PictureAvatar
                            from={props.kind.source.pictures}
                            url={project()?.iconUrl ?? target.iconUrl}
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
                                        elements instead of HTML; the source says whether its images show,
                                        and each is fetched by the service, never loaded by the page. */}
                                    <PaperMarkdown
                                        text={project()!.body}
                                        renderImage={project()!.allowImages ? (image) => <BodyPicture image={image} /> : undefined}
                                        allowHtml={project()!.allowHtml}
                                    />
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
