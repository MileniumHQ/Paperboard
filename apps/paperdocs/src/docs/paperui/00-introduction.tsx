import { PaperLink, PaperSeparator, PaperText, PaperTextList } from "paperui";

export default function f() {
    return (
        <>
            <PaperText preset="header">Introduction</PaperText>
            <PaperSeparator />
            <PaperText preset="subheader">What is PaperUI?</PaperText>
            <PaperText preset="body">
                PaperUI is a tactile and beautiful SolidJS component library
                made for Paperboard. PaperUI shines most when used in the
                creation of <PaperLink href="/docs/paperapi">boards</PaperLink>{" "}
                for Paperboard, but can be used elsewhere if customized.
            </PaperText>
            <PaperSeparator />
            <PaperText preset="subheader">Thinking in PaperUI</PaperText>
            <PaperText preset="body">
                When developing a board, it's important that it matches the
                theme and design language of the rest of the app. PaperUI is
                built for this; you'll likely end up creating compliant
                interfaces without even thinking about it. Here are some general
                guidelines to keep in mind:
            </PaperText>
            <PaperTextList>
                <PaperText preset="body">
                    <strong>Avoid using hard-coded styles.</strong> As you'll
                    see soon, PaperUI contains many preset styles and variables
                    you can reference when creating your own UI, and more often
                    than not, you won't have to write style code at all. This
                    doesn't mean custom styles are discouraged—in fact, you'll
                    often need to write basic styles—all this means is that
                    doing so should be rare.
                </PaperText>
            </PaperTextList>
        </>
    );
}
