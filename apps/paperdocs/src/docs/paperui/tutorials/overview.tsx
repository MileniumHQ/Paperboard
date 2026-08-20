import {
    PaperCode,
    PaperContainer,
    PaperFlex,
    PaperLink,
    PaperQuote,
    PaperSeparator,
    PaperText,
    PaperTextList,
} from "paperui";

export default function f() {
    return (
        <>
            <PaperText preset="header">Tutorials</PaperText>
            <PaperText preset="body">
                Practical workflow guides, real-world development walk-throughs, and architectural best practices for building Paperboard extensions with PaperUI.
            </PaperText>
            <PaperSeparator />

            <PaperText id="overview" preset="subheader">
                Overview
            </PaperText>
            <PaperText preset="body">
                The <strong>Tutorials</strong> section comprises human-authored guides focused on practical application design, complex state orchestration, custom board development, and end-to-end integration with Paperboard APIs.
            </PaperText>

            <PaperQuote variant="blue" icon="edit_note" title="Human-Authored Guides">
                Tutorial articles in this section are curated and written by core contributors to provide step-by-step guidance on real-world engineering patterns.
            </PaperQuote>

            <PaperSeparator />

            <PaperText id="upcoming-guides" preset="subheader">
                Planned Guides
            </PaperText>
            <PaperTextList>
                <PaperText preset="body">
                    <strong>Building Your First Paperboard Board:</strong> An end-to-end guide creating an extension board with <PaperCode>PaperFlex</PaperCode>, <PaperCode>PaperRail</PaperCode>, and reactive widgets.
                </PaperText>
                <PaperText preset="body">
                    <strong>Managing Complex Multi-Step Forms:</strong> Utilizing <PaperCode>PaperWizard</PaperCode> and <PaperCode>PaperSettingList</PaperCode> with validation schemas.
                </PaperText>
                <PaperText preset="body">
                    <strong>Designing Custom Themed Interfaces:</strong> Extending CSS custom properties and surface tokens without breaking dark/light polarity.
                </PaperText>
            </PaperTextList>

            <PaperSeparator />

            <PaperText id="see-also" preset="subheader">
                See Also
            </PaperText>
            <PaperTextList>
                <PaperText preset="body">
                    <PaperLink href="/paperui/quick-start">Quick Start Guide</PaperLink> — Initial project bootstrap and setup.
                </PaperText>
                <PaperText preset="body">
                    <PaperLink href="/paperui/introduction">Introduction</PaperLink> — Core architectural concepts and philosophy.
                </PaperText>
            </PaperTextList>
        </>
    );
}
