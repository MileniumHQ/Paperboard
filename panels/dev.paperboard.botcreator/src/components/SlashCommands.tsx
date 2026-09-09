import {
    PaperFlex,
    PaperText,
    PaperQuote,
} from "@paperboard-dev/paperui";

export default function SlashCommands() {
    return (
        <PaperFlex fullHeight fullWidth padding="double" gap="threefourths">
            <PaperText weight={700} size={5}>
                Slash Commands
            </PaperText>
            <PaperText preset="body" color="light-text">
                Custom slash command builder coming soon.
            </PaperText>
            <PaperQuote variant="brand" icon="extension">
                Install Actions from the Panel Library to handle Discord slash commands.
            </PaperQuote>
        </PaperFlex>
    );
}

export { SlashCommands };
