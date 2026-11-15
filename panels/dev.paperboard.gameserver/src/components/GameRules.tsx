import { createEffect, createMemo, createSignal, For, onCleanup, Show, on } from "solid-js";
import {
    PaperCard,
    PaperFlex,
    PaperInput,
    PaperLink,
    PaperPageHeader,
    PaperQuote,
    PaperSettingItem,
    PaperSettingList,
    PaperText,
    PaperToggle,
} from "@mileniumhq/paperui";
import { serverStatus, gamerules, serverVersion } from "../lib/server";
import { gamerulesFor, type GameruleEntry } from "../core/gamerules";
import { humanizeIdentifier } from "../core/format";
import { errorMessage } from "../lib/failure";
import { createSaves, type SavedSetting } from "../lib/saves";
import { commitOnEnter } from "./GameOptions";
import { serverCalls } from "../lib/api";

const WIKI_URL = "https://minecraft.wiki/w/Game_rule";

/**
 * A rule's control: a switch flips at once, and a text or number rule is
 * sent when the field is left or Enter is pressed, never a half-typed value.
 */
function RuleControl(props: { valueType: string; rule: SavedSetting<string> }) {
    const [draft, setDraft] = createSignal<string | null>(null);
    return (
        <Show
            when={props.valueType === "boolean"}
            fallback={
                <PaperInput
                    type={props.valueType === "number" ? "number" : "text"}
                    value={draft() ?? props.rule.value()}
                    onInput={(e) => setDraft(e.currentTarget.value)}
                    onKeyDown={commitOnEnter}
                    onBlur={() => {
                        const typed = draft();
                        setDraft(null);
                        if (typed !== null && typed.trim() !== "" && typed !== props.rule.value()) props.rule.set(typed.trim());
                    }}
                />
            }
        >
            <PaperToggle checked={props.rule.value() === "true"} onChange={(checked) => props.rule.set(String(checked))} />
        </Show>
    );
}

export default function GameRules() {
    const [search, setSearch] = createSignal("");
    const [syncError, setSyncError] = createSignal("");
    const [ruleError, setRuleError] = createSignal<{ title: string; message: string } | null>(null);

    const isOnline = () => serverStatus() === "online";
    const available = createMemo(() => gamerulesFor(serverVersion()));

    // truth, not defaults: the service reads every visible rule from the
    // running server (and re-applies offline edits at boot); responses
    // arrive through the log parser and sync into the gamerules() signal.
    // Until a response lands, the registry default is the honest fallback.
    // a newer ask (or the server going offline) makes an older answer moot;
    // the service asks for every rule the server's version has, so a new
    // version's list is asked again
    createEffect(
        on([isOnline, available], ([online]) => {
            setSyncError("");
            if (!online) return;
            let current = true;
            onCleanup(() => (current = false));
            serverCalls
                .queryGamerules()
                .catch((err) => current && setSyncError(errorMessage(err)));
        }),
    );

    // the service owns the console and the config: online edits go live,
    // offline edits persist and re-apply at next start, and a failure to
    // persist one comes back here to be shown
    const saves = createSaves({
        failed: (err, name) => setRuleError({ title: `${humanizeIdentifier(name)} not changed`, message: errorMessage(err) }),
        changed: () => setRuleError(null),
    });
    const ruleSetting = (rule: GameruleEntry) =>
        saves.setting(
            rule.name,
            () => gamerules()[rule.name] ?? rule.defaultValue,
            async (value) => {
                await serverCalls.setGamerule({ name: rule.name, value });
            },
        );

    const visibleGamerules = () => {
        const query = search().toLowerCase().trim();
        if (!query) return available();
        return available().filter(
            (rule) =>
                rule.name.toLowerCase().includes(query) ||
                humanizeIdentifier(rule.name).toLowerCase().includes(query) ||
                rule.description.toLowerCase().includes(query),
        );
    };

    return (
        <>
            <PaperPageHeader icon="list_alt_check" title="Game Rules" />
            <PaperCard>
                <PaperFlex padding="full">
                    <PaperInput
                        fullWidth
                        icon="search"
                        placeholder="Search game rules..."
                        value={search()}
                        onInput={(e) => setSearch(e.currentTarget.value)}
                    />
                </PaperFlex>
            </PaperCard>
            <Show when={!isOnline()}>
                <PaperQuote variant="warning" icon="info" title="Server offline">
                    Edits are saved and applied the next time the server starts. Values load live once it is online.
                </PaperQuote>
            </Show>
            <Show when={syncError()}>
                <PaperQuote variant="danger" icon="warning" title="Game rules not read from the server" onDismiss={() => setSyncError("")}>
                    {syncError()}
                </PaperQuote>
            </Show>
            <Show when={ruleError()}>
                {(error) => (
                    <PaperQuote variant="danger" icon="warning" title={error().title} onDismiss={() => setRuleError(null)}>
                        {error().message}
                    </PaperQuote>
                )}
            </Show>
            <PaperSettingList autoHeight>
                <For each={visibleGamerules()}>
                    {(rule) => {
                        const setting = ruleSetting(rule);
                        return (
                            <PaperSettingItem title={humanizeIdentifier(rule.name)} description={rule.description}>
                                <RuleControl valueType={rule.valueType} rule={setting} />
                            </PaperSettingItem>
                        );
                    }}
                </For>
            </PaperSettingList>
            <PaperText size={2} color="text-subtle">
                <Show when={isOnline()}>Values are read live from the running server. </Show>
                Descriptions provided by <PaperLink href={WIKI_URL} target="_blank">Minecraft Wiki</PaperLink>.
            </PaperText>
        </>
    );
}
