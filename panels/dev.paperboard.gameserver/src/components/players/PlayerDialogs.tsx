// The Players tab's dialogs: whitelisting a name, deleting a player's data,
// and a kick or ban with its reason. Each sends through what it is given and
// shows the refusal.
import { createEffect, createSignal, on, Show } from "solid-js";
import { createAction, PaperButton, PaperFlex, PaperInput, PaperModal, PaperSelector, PaperSelectorItem, PaperText, showError } from "@mileniumhq/paperui";
import { JAVA_NAME_PATTERN, PLAYER_NAME_PATTERN } from "../../core/players";
import { bedrockPlayerName, type BedrockNaming } from "../../core/bedrock";
import { errorMessage } from "../../lib/failure";

/**
 * Whitelists a name that may not be on the roster yet. A gamertag becomes
 * the name Floodgate gives it here. The service validates the name again;
 * these checks are only so the field can explain itself before the round trip.
 */
export function WhitelistDialog(props: {
    open: boolean;
    onClose: () => void;
    /** how Floodgate names Bedrock players; null without crossplay */
    bedrock: BedrockNaming | null;
    disabled: boolean;
    /** whitelists the name; throws the service's refusal */
    onAdd: (name: string) => Promise<void>;
}) {
    const [typed, setTyped] = createSignal("");
    const [error, setError] = createSignal("");
    const [edition, setEdition] = createSignal<"java" | "bedrock">("java");

    // every opening starts empty, on Java
    createEffect(on(() => props.open, (open) => {
        if (!open) return;
        setTyped("");
        setError("");
        setEdition("java");
    }));

    const add = async () => {
        const entered = typed().trim();
        if (!entered) return;
        const naming = props.bedrock;
        let name = entered;
        if (naming && edition() === "bedrock") {
            // a pasted Floodgate name already carries the prefix
            const gamertag = entered.startsWith(naming.prefix) ? entered.slice(naming.prefix.length) : entered;
            name = bedrockPlayerName(gamertag, naming);
            if (!gamertag || !PLAYER_NAME_PATTERN.test(name)) {
                setError("Gamertags are letters, numbers and spaces.");
                return;
            }
        } else if (!JAVA_NAME_PATTERN.test(name)) {
            setError("Usernames are 1–16 letters, numbers or underscores.");
            return;
        }
        try {
            await props.onAdd(name);
        } catch (err) {
            showError("Couldn't add to the whitelist", errorMessage(err));
            return;
        }
        props.onClose();
    };

    return (
        <PaperModal
            open={props.open}
            onClose={props.onClose}
            title="Add to whitelist"
            size="small"
            footer={
                <>
                    <PaperButton variant="text" onClick={props.onClose}>
                        Cancel
                    </PaperButton>
                    <PaperButton variant="primary" disabled={props.disabled || !typed().trim()} onClick={() => void add()}>
                        Add
                    </PaperButton>
                </>
            }
        >
            <PaperFlex direction="column" gap="full" fullWidth>
                <Show when={props.bedrock}>
                    <PaperSelector
                        name="whitelistEdition"
                        value={edition()}
                        onValueChange={(value) => {
                            setEdition(value === "bedrock" ? "bedrock" : "java");
                            setError("");
                        }}
                        horizontal
                    >
                        <PaperSelectorItem value="java" icon="computer">Java</PaperSelectorItem>
                        <PaperSelectorItem value="bedrock" icon="sports_esports">Bedrock</PaperSelectorItem>
                    </PaperSelector>
                </Show>
                <PaperFlex direction="column" gap="half" fullWidth>
                    <PaperInput
                        fullWidth
                        autofocus
                        icon="person"
                        label={edition() === "bedrock" ? "Gamertag" : "Username"}
                        error={error() || undefined}
                        value={typed()}
                        onInput={(e) => {
                            setTyped(e.currentTarget.value);
                            setError("");
                        }}
                        onKeyDown={(e) => {
                            // Enter adds only when the Add button would
                            if (e.key === "Enter" && !props.disabled) void add();
                        }}
                    />
                    <PaperText size={2} color="text-subtle">
                        {edition() === "bedrock"
                            ? "Works once they have joined any Geyser server."
                            : "They don't need to have joined before."}
                    </PaperText>
                </PaperFlex>
            </PaperFlex>
        </PaperModal>
    );
}

export function DeleteDataDialog(props: { open: boolean; player: string | undefined; onClose: () => void; onDelete: () => void }) {
    return (
        <PaperModal
            open={props.open}
            onClose={props.onClose}
            title={`Delete ${props.player ?? "player"}'s data`}
            size="small"
            footer={
                <>
                    <PaperButton variant="text" onClick={props.onClose}>
                        Cancel
                    </PaperButton>
                    <PaperButton variant="danger" onClick={props.onDelete}>
                        Delete Data
                    </PaperButton>
                </>
            }
        >
            <PaperText preset="body">
                This moves this player's inventory, position, and progress to a
                .trash folder inside the server folder. They will join as a fresh
                player. If they are online, they are kicked first. Whitelist,
                operator and ban settings stay.
            </PaperText>
        </PaperModal>
    );
}

export function ReasonActionDialog(props: {
    open: boolean;
    title: string;
    confirmLabel: string;
    onClose: () => void;
    /** false when the action failed: the reason stays typed for another go */
    onSubmit: (reason: string) => Promise<boolean>;
}) {
    const [reason, setReason] = createSignal("");
    // one press sends one action: the button waits for it
    const send = createAction({ message: errorMessage });

    const submit = async () => {
        if (!props.open || send.busy()) return;
        await send.run(props.title, async () => {
            if (await props.onSubmit(reason().trim())) setReason("");
        });
    };

    return (
        <PaperModal
            open={props.open}
            onClose={props.onClose}
            title={props.title}
            size="small"
            footer={
                <>
                    <PaperButton variant="text" onClick={props.onClose}>
                        Cancel
                    </PaperButton>
                    <PaperButton variant="danger" disabled={send.busy()} onClick={() => void submit()}>
                        {props.confirmLabel}
                    </PaperButton>
                </>
            }
        >
            <PaperFlex direction="column" gap="half" fullWidth>
                <PaperInput
                    fullWidth
                    autofocus
                    label="Reason (optional)"
                    value={reason()}
                    onInput={(e) => setReason(e.currentTarget.value)}
                    onKeyDown={(e) => {
                        if (e.key === "Enter") void submit();
                    }}
                />
            </PaperFlex>
        </PaperModal>
    );
}
