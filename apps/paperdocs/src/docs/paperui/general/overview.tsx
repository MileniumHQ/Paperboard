import { For } from "solid-js";
import {
    PaperCode,
    PaperFlex,
    PaperLink,
    PaperTable,
    PaperText,
    PaperTextList,
} from "@mileniumhq/paperui";

const CHOICES: { need: string; items: { name: string; key: string }[] }[] = [
    { need: "Run an action or link somewhere", items: [{ name: "PaperButton", key: "paperbutton" }, { name: "PaperCopyButton", key: "papercopybutton" }, { name: "PaperLink", key: "paperlink" }] },
    { need: "Take input", items: [{ name: "PaperInput", key: "paperinput" }, { name: "PaperToggle", key: "papertoggle" }, { name: "PaperCheckbox", key: "papercheckbox" }, { name: "PaperRange", key: "paperrange" }, { name: "PaperSelectMenu", key: "paperselectmenu" }, { name: "PaperSelector", key: "paperselector" }, { name: "PaperEditor", key: "papereditor" }] },
    { need: "Group and lay out content", items: [{ name: "PaperFlex", key: "paperflex" }, { name: "PaperCard", key: "papercard" }, { name: "PaperGrid", key: "papergrid" }, { name: "PaperSpacer", key: "paperspacer" }, { name: "PaperSeparator", key: "paperseparator" }, { name: "PaperSplit", key: "papersplit" }] },
    { need: "Name a page or a section", items: [{ name: "PaperPageHeader", key: "paperpageheader" }, { name: "PaperSectionHeader", key: "papersectionheader" }, { name: "PaperText", key: "papertext" }] },
    { need: "Show a list of things", items: [{ name: "PaperList", key: "paperlist" }, { name: "PaperTable", key: "papertable" }, { name: "PaperKeyValueList", key: "paperkeyvaluelist" }, { name: "PaperTextList", key: "papertextlist" }, { name: "PaperMediaCard", key: "papermediacard" }, { name: "PaperPagination", key: "paperpagination" }] },
    { need: "Show a number or a state", items: [{ name: "PaperStatTile", key: "paperstattile" }, { name: "PaperChart", key: "paperchart" }, { name: "PaperProgress", key: "paperprogress" }, { name: "PaperLoader", key: "paperloader" }, { name: "PaperBadge", key: "paperbadge" }, { name: "PaperChip", key: "paperchip" }, { name: "PaperSwatch", key: "paperswatch" }] },
    { need: "Tell the user something", items: [{ name: "PaperQuote", key: "paperquote" }, { name: "PaperEmptyState", key: "paperemptystate" }, { name: "PaperModal", key: "papermodal" }] },
    { need: "Navigate", items: [{ name: "PaperMenu", key: "papermenu" }, { name: "PaperRail", key: "paperrail" }, { name: "PaperMenuBar", key: "papermenubar" }, { name: "PaperContextMenu", key: "papercontextmenu" }] },
    { need: "Show code, logs, or rich text", items: [{ name: "PaperCode", key: "papercode" }, { name: "PaperConsole", key: "paperconsole" }, { name: "PaperMarkdown", key: "papermarkdown" }, { name: "PaperProse", key: "paperprose" }, { name: "PaperKbd", key: "paperkbd" }] },
    { need: "Show a picture, an icon, or sound", items: [{ name: "PaperIcon", key: "papericon" }, { name: "PaperAvatar", key: "paperavatar" }, { name: "PaperAudio", key: "paperaudio" }] },
    { need: "Add motion", items: [{ name: "PaperEffect", key: "papereffect" }, { name: "PaperPresence", key: "paperpresence" }] },
];

export default function PaperUiOverviewDoc() {
    return (
        <PaperFlex direction="column" gap="double" fullWidth>
            <PaperText preset="header" as="h1">PaperUI</PaperText>
            <PaperText preset="body" as="p">
                PaperUI is the SolidJS component library that every Paperboard panel is built with: components, page templates, and the design tokens behind them.
                A panel made only from PaperUI components and props needs no CSS, matches Paperboard in light and dark, and gets the phone layout for free.
                Install it as <PaperCode>@mileniumhq/paperui</PaperCode>, with <PaperCode>solid-js</PaperCode> version 1.9 or later as a peer dependency.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="parts">What is in the package</PaperText>
            <PaperTable>
                <thead>
                    <tr>
                        <th>Part</th>
                        <th>What it holds</th>
                        <th>Where</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td>Components</td>
                        <td>Controls, text, lists, tables, dialogs, feedback, and charts. Each takes tokens through props.</td>
                        <td>The Components pages, starting with <PaperLink href="/docs/paperui/paperbutton/">PaperButton</PaperLink></td>
                    </tr>
                    <tr>
                        <td>Templates</td>
                        <td>The layouts a panel is made of: the panel shell, the page column, flex containers, setting lists, split panes, wizards, a file browser, and Home widgets.</td>
                        <td>The Templates pages, starting with <PaperLink href="/docs/paperui/paperpanel/">PaperPanel</PaperLink></td>
                    </tr>
                    <tr>
                        <td>Tokens</td>
                        <td>CSS custom properties for color, surfaces, type, spacing, size and motion, in light and dark.</td>
                        <td><PaperLink href="/docs/paperui/colors/">Colors</PaperLink>, <PaperLink href="/docs/paperui/surfaces/">Surfaces and borders</PaperLink>, <PaperLink href="/docs/paperui/typography/">Typography</PaperLink>, <PaperLink href="/docs/paperui/spacing/">Spacing and layout</PaperLink>, <PaperLink href="/docs/paperui/motion/">Motion and effects</PaperLink></td>
                    </tr>
                    <tr>
                        <td>Utilities</td>
                        <td>Helpers for reading tokens in code, the clipboard, polling, haptics, ANSI text, and the panel contexts. Two stylesheets: <PaperCode>style.css</PaperCode> and <PaperCode>panel.css</PaperCode>.</td>
                        <td><PaperLink href="/docs/paperui/utilities/">Utilities</PaperLink></td>
                    </tr>
                </tbody>
            </PaperTable>

            <PaperText preset="subheader" as="h2" id="page-structure">How a panel page is built</PaperText>
            <PaperText preset="body" as="p">
                Every panel is a tree of the same few parts.
                The provider is the root. The panel shell holds a menu and the group of pages that the menu picks between. Each page is a column of header and cards.
            </PaperText>
            <PaperCode block language="text">
{`PaperProvider        theme and scoped styles, once, at the root
  PaperPanel         menu beside pages, with the phone layout built in
    PaperMenu        the navigation, with one PaperMenuItem per page
    PaperInterfaceGroup   shows the PaperInterfaceItem that matches the menu
      PaperInterfaceItem  a centered, scrolling PaperPage
        PaperPageHeader   the page's title and actions
        PaperCard         one boxed section
          PaperFlex       rows and columns inside it
            PaperText, PaperButton, PaperInput`}
            </PaperCode>
            <PaperText preset="body" as="p">
                The <PaperLink href="/docs/paperui/quickstart/">Quick start</PaperLink> has the complete, compiling version of this tree.
                A panel with one screen and no menu puts a <PaperLink href="/docs/paperui/paperpage/">PaperPage</PaperLink> directly under the provider.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="rules">The rules that keep a panel looking right</PaperText>
            <PaperTextList>
                <li>Build from PaperUI components and props. If a screen needs UI PaperUI lacks, ask for the component instead of writing CSS.</li>
                <li>Write no inline styles and no static values. Spacing, sizes and colors are tokens passed through props: <PaperCode>gap="half"</PaperCode>, <PaperCode>width="field"</PaperCode>, <PaperCode>variant="danger"</PaperCode>.</li>
                <li>When a token must appear in code, call <PaperCode>getVarCss("name")</PaperCode>. Never write <PaperCode>var(--paper-name)</PaperCode> yourself.</li>
                <li>Never write pixels or rem for a size. Pick a size token, or a component's own <PaperCode>size</PaperCode> prop.</li>
                <li>Keep a modal mounted and drive it with <PaperCode>open</PaperCode>. Never put it inside <PaperCode>Show</PaperCode>.</li>
                <li>Next to a confirm that is not destructive, Cancel is <PaperCode>variant="text"</PaperCode>.</li>
                <li>Show every failure. A press that fails calls <PaperLink href="/docs/paperui/papertoast/">showToast</PaperLink> in its <PaperCode>catch</PaperCode>; a failure that stays shows with <PaperLink href="/docs/paperui/paperquote/">PaperQuote</PaperLink> or the component's own error state. Never swallow one.</li>
            </PaperTextList>
            <PaperText preset="body" as="p">
                The panel template ships a test that fails when a page writes an inline style.
                How to design a good panel on top of these rules is taught in <PaperLink href="/docs/developers/ui/">Building a good panel UI</PaperLink>.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="choose">Choosing a component</PaperText>
            <PaperText preset="body" as="p">
                Find the situation, then open the component.
                Many component pages end with the neighbors they are most often confused with.
            </PaperText>
            <PaperTable>
                <thead>
                    <tr>
                        <th>You need to</th>
                        <th>Components</th>
                    </tr>
                </thead>
                <tbody>
                    <For each={CHOICES}>
                        {(group) => (
                            <tr>
                                <td>{group.need}</td>
                                <td>
                                    <For each={group.items}>
                                        {(item, i) => (
                                            <>
                                                {i() > 0 ? ", " : ""}
                                                <PaperLink href={`/docs/paperui/${item.key}/`}>{item.name}</PaperLink>
                                            </>
                                        )}
                                    </For>
                                </td>
                            </tr>
                        )}
                    </For>
                </tbody>
            </PaperTable>

            <PaperText preset="subheader" as="h2" id="where-next">Where to go next</PaperText>
            <PaperTextList>
                <li><PaperLink href="/docs/paperui/quickstart/">Quick start</PaperLink> builds a minimal panel from the provider down.</li>
                <li><PaperLink href="/docs/paperui/design-language/">Design language</PaperLink> explains the surfaces, borders, color roles and shadow that give Paperboard its look.</li>
                <li><PaperLink href="/docs/developers/ui/">Building a good panel UI</PaperLink> is the guide to layout, states and feedback.</li>
                <li><PaperLink href="/docs/paperapi/overview/">PaperAPI</PaperLink> is the other half of a panel: files, secrets, processes and a background service.</li>
            </PaperTextList>
        </PaperFlex>
    );
}
