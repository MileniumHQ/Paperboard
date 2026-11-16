import { For, Show } from "solid-js";
import {
    PaperBadge,
    PaperButton,
    PaperCard,
    PaperError,
    PaperFlex,
    PaperIcon,
    PaperInput,
    PaperLink,
    PaperList,
    PaperListItem,
    PaperText,
} from "@mileniumhq/paperui";
import type { AddonHit, AddonKind, AddonListing, InstalledAddon } from "../../lib/addons/kind";
import type { createAddonSearch } from "./state";
import PictureAvatar from "../PictureAvatar";

const truncate = (text: string, max: number) => (text.length > max ? `${text.slice(0, max).trimEnd()}…` : text);

/** The list of what the server already has. */
export function AddonInstalledList<Meta>(props: {
    kind: AddonKind<Meta>;
    listing: AddonListing<Meta>;
    busy: boolean;
    onOpen(item: InstalledAddon): void;
    onAction(item: InstalledAddon, does: "install" | "remove"): void;
}) {
    return (
        <Show when={props.listing.items.length > 0}>
            <PaperFlex direction="column" gap="half">
                <PaperText size={5} weight={700}>
                    {props.kind.installedTitle}
                </PaperText>
                <Show when={props.listing.note}>
                    <PaperText size={2} color="text-subtle">
                        {props.listing.note}
                    </PaperText>
                </Show>
                <PaperList
                    name="addon-installed"
                    value=""
                    onValueChange={(id) => {
                        const item = props.listing.items.find((candidate) => candidate.id === id);
                        if (item) props.onOpen(item);
                    }}
                    buttons
                    selectable={props.kind.itemClick !== "none"}
                    fullWidth
                >
                    <For each={props.listing.items}>
                        {(item) => (
                            <PaperListItem
                                value={item.id}
                                icon={<PictureAvatar from={props.kind.source.pictures} url={item.iconUrl} shape="square" size="large" fallbackIcon={props.kind.glyph} />}
                                description={
                                    // a file name has no spaces to wrap at; it breaks where it must
                                    <PaperText breakWord size={1} weight={600}>
                                        {[item.subtitle, item.footer].filter(Boolean).join(" · ")}
                                    </PaperText>
                                }
                                actions={
                                    <PaperFlex direction="row" gap="half" align="center">
                                        <PaperBadge variant={item.badge.variant}>{item.badge.label}</PaperBadge>
                                        <For each={props.kind.itemActions?.filter((a) => a.does !== "install" || item.project)}>
                                            {(action) => (
                                                <PaperButton
                                                    size="tiny"
                                                    variant={action.variant}
                                                    disabled={props.busy || action.disabled?.()}
                                                    onClick={() => props.onAction(item, action.does)}
                                                >
                                                    <PaperIcon aria-hidden="true">{action.icon}</PaperIcon>
                                                    {action.label}
                                                </PaperButton>
                                            )}
                                        </For>
                                    </PaperFlex>
                                }
                            >
                                {item.title}
                            </PaperListItem>
                        )}
                    </For>
                </PaperList>
            </PaperFlex>
        </Show>
    );
}

/** The search box. */
export function AddonSearchCard<Meta>(props: { kind: AddonKind<Meta>; search: ReturnType<typeof createAddonSearch> }) {
    return (
        <PaperCard>
            <PaperFlex direction="column" gap="half" padding="full">
                <PaperInput
                    fullWidth
                    icon="search"
                    placeholder={props.kind.noun[0]!.toUpperCase() + props.kind.noun.slice(1)}
                    value={props.search.query()}
                    onInput={(e) => props.search.type(e.currentTarget.value)}
                    onKeyDown={(e) => {
                        if (e.key === "Enter") void props.search.run();
                    }}
                />
                <PaperText size={2} color="text-subtle">
                    {props.kind.searchScope()} provided by{" "}
                    <PaperLink href={props.kind.source.url} target="_blank">
                        {props.kind.source.name}
                    </PaperLink>
                    .
                </PaperText>
                <For each={props.kind.source.notices?.() ?? []}>
                    {(notice) => (
                        <PaperText size={1} color="text-subtle">
                            {notice.text}
                            <Show when={notice.link}>
                                {(link) => (
                                    <>
                                        {notice.text ? " " : ""}
                                        <PaperLink href={link().href} target="_blank">
                                            {link().label}
                                        </PaperLink>
                                    </>
                                )}
                            </Show>
                        </PaperText>
                    )}
                </For>
            </PaperFlex>
        </PaperCard>
    );
}

/** The list of projects a search found. */
export function AddonResults<Meta>(props: {
    kind: AddonKind<Meta>;
    search: ReturnType<typeof createAddonSearch>;
    installedProjects: Set<string>;
    onOpen(hit: AddonHit): void;
}) {
    return (
        <>
            <Show when={props.search.searching()}>
                <PaperFlex padding="full" center>
                    <PaperText size={3} color="text-subtle">
                        Searching {props.kind.source.name}...
                    </PaperText>
                </PaperFlex>
            </Show>
            <Show when={!props.search.searching() && props.search.error()}>
                {(err) => <PaperError title={`Couldn't search ${props.kind.source.name}`} error={err()} action={{ label: "Try again", onClick: () => void props.search.run() }} />}
            </Show>
            <Show when={!props.search.searching() && !props.search.error() && props.search.results()}>
                {(hits) => (
                    <Show
                        when={hits().length > 0}
                        fallback={
                            <PaperFlex padding="full" center>
                                <PaperText size={3} color="text-subtle">
                                    {props.kind.emptySearch()}
                                </PaperText>
                            </PaperFlex>
                        }
                    >
                        <PaperList
                            name="addon-results"
                            value=""
                            onValueChange={(projectId) => {
                                const hit = hits().find((candidate) => candidate.projectId === projectId);
                                if (hit) props.onOpen(hit);
                            }}
                            buttons
                            fullWidth
                        >
                            <For each={hits()}>
                                {(hit) => (
                                    <PaperListItem
                                        value={hit.projectId}
                                        icon={<PictureAvatar from={props.kind.source.pictures} url={hit.iconUrl} shape="square" size="large" fallbackIcon={props.kind.glyph} />}
                                        description={[truncate(hit.description, 110), hit.stat].filter(Boolean).join(" · ")}
                                        actions={
                                            <Show when={props.installedProjects.has(hit.projectId)}>
                                                <PaperBadge variant="success">{props.kind.resultBadge}</PaperBadge>
                                            </Show>
                                        }
                                    >
                                        {hit.title}
                                    </PaperListItem>
                                )}
                            </For>
                        </PaperList>
                    </Show>
                )}
            </Show>
        </>
    );
}
