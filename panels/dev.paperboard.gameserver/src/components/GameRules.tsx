import { createSignal, For, onMount, Show } from "solid-js";
import {
    PaperFlex,
    PaperInput,
    PaperLink,
    PaperSettingItem,
    PaperSettingList,
    PaperText,
    PaperToggle,
} from "@paperboard-dev/paperui";
import { processApi } from "@paperboard-dev/paperapi";
import { serverStatus, SERVER_PROC_ID } from "../lib/server";
import { mcVersionAtLeast } from "../lib/capabilities";
import { GAMERULES } from "../generated/gamerules.generated";

const WIKI_URL = "https://minecraft.wiki/w/Game_rule";

// Rules the running server version actually has.
function availableGamerules() {
    return GAMERULES.filter((rule) => !rule.addedIn || mcVersionAtLeast(rule.addedIn));
}

// Component so the DOM node persists across value changes
function RuleControl(props: {
    valueType: string;
    value: () => string;
    onUpdate: (value: string) => void;
}) {
    return (
        <Show
            when={props.valueType === "boolean"}
            fallback={
                <PaperInput
                    type={props.valueType === "number" ? "number" : "text"}
                    value={props.value()}
                    onInput={(e) => props.onUpdate(e.currentTarget.value)}
                />
            }
        >
            <PaperToggle
                checked={props.value() === "true"}
                onChange={(checked) => props.onUpdate(String(checked))}
            />
        </Show>
    );
}

export default function GameRules() {
    const [values, setValues] = createSignal<Record<string, string>>({});
    const [search, setSearch] = createSignal("");

    const isOnline = () => serverStatus() === "online";

    onMount(() => {
        const initial: Record<string, string> = {};
        for (const rule of availableGamerules()) {
            initial[rule.name] = rule.defaultValue;
        }
        setValues(initial);
    });

    // Game rules apply live through the console — no restart needed.
    const updateRule = (name: string, value: string) => {
        setValues((prev) => ({ ...prev, [name]: value }));
        if (!isOnline()) return;
        processApi.write(SERVER_PROC_ID, `gamerule ${name} ${value}\n`);
    };

    const visibleGamerules = () => {
        const query = search().toLowerCase().trim();
        if (!query) return availableGamerules();
        return availableGamerules().filter(
            (rule) =>
                rule.name.toLowerCase().includes(query) ||
                rule.description.toLowerCase().includes(query),
        );
    };

    return (
        <PaperFlex direction="column" fullWidth fullHeight gap="half">
            <PaperFlex
                direction="column"
                gap="half"
                fullWidth
                padding="full"
                style={{ "flex-shrink": 0 }}
            >
                <PaperInput
                    fullWidth
                    icon="search"
                    placeholder="Search game rules..."
                    value={search()}
                    onInput={(e) => setSearch(e.currentTarget.value)}
                />
                <Show when={!isOnline()}>
                    <PaperText size={3} weight={500}>
                        Start the server to change game rules.
                    </PaperText>
                </Show>
                <PaperText size={2} color="light-text">
                    Descriptions provided by{" "}
                    <PaperLink href={WIKI_URL} target="_blank">Minecraft Wiki</PaperLink>.
                </PaperText>
            </PaperFlex>

            <PaperSettingList style={{ flex: 1, "min-height": 0 }}>
                <For each={visibleGamerules()}>
                    {(rule) => (
                        <PaperSettingItem
                            title={rule.name}
                            description={rule.description}
                            disabled={!isOnline()}
                        >
                            <RuleControl
                                valueType={rule.valueType}
                                value={() => values()[rule.name] ?? rule.defaultValue}
                                onUpdate={(value) => updateRule(rule.name, value)}
                            />
                        </PaperSettingItem>
                    )}
                </For>
            </PaperSettingList>
        </PaperFlex>
    );
}
