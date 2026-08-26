import { PaperFlex, PaperText } from "@paperboard-dev/paperui";
import { sectionKey, sectionMeta } from "../utils/routeUtils";

export function Footer() {
    return (
        <footer class="docs-footer">
            <PaperFlex
                direction="column"
                align="center"
                padding="double"
                gap="half"
                class="footer"
            >
                <PaperFlex
                    direction="row"
                    justify="space-between"
                    align="center"
                    style={{
                        width: "100%",
                        padding: "var(--paper-uigap) 0",
                    }}
                >
                    <PaperFlex direction="row" align="center" gap="half">
                        <PaperText size={2} weight={600}>
                            Documentation
                        </PaperText>
                    </PaperFlex>
                    <PaperText size={2}>this footer sucks</PaperText>
                </PaperFlex>
            </PaperFlex>
        </footer>
    );
}
