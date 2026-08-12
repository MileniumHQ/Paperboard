import {
    PaperCode,
    PaperLink,
    PaperQuote,
    PaperSeparator,
    PaperText,
} from "paperui";

export default function f() {
    return (
        <>
            <PaperText preset="header">Quick Start</PaperText>
            <PaperText preset="body">Let's get you set up!</PaperText>
            <PaperSeparator />
            <PaperText id="getting-started" preset="subheader">
                Getting started
            </PaperText>
            <PaperText id="prerequisites" preset="title">
                Prerequisites
            </PaperText>
            <PaperText preset="body">
                Since PaperUI is a SolidJS library, it's of paramount importance
                that you are familiar with the{" "}
                <PaperLink href="https://docs.solidjs.com/" external>
                    SolidJS framework
                </PaperLink>
                .
            </PaperText>
            <PaperText id="installation" preset="title">
                1. Installation
            </PaperText>
            <PaperText preset="body">
                First, import SolidJS and PaperUI from NPM using your preferred
                package manager.
            </PaperText>
            <PaperCode block lang="bash">
                npm install paperui solid-js
            </PaperCode>
            <PaperText preset="body">
                If you are using PaperUI's included styles, import them at the
                top of your entry JSX file (like{" "}
                <PaperCode>index.tsx</PaperCode>
                ).
            </PaperText>
            <PaperCode block language="jsx">
                import "paperui/style.css";
            </PaperCode>
            <PaperQuote variant="blue" icon="info" title="FYI">
                If you import these styles, PaperUI will also import the
                included fonts for you. (Nunito, Nunito Sans, SUSE Mono, and
                Google's Material Symbols Rounded)
            </PaperQuote>
            <PaperText id="provider-setup" preset="title">
                2. Provider Setup
            </PaperText>
            <PaperText preset="body">
                Wrap your app in the{" "}
                <PaperLink href="./components/PaperProvider">
                    <PaperCode>PaperProvider</PaperCode>
                </PaperLink>{" "}
                component. This establishes styles and context.
            </PaperText>
            <PaperCode block language="jsx">
                {`import { render } from "solid-js/web";
import { PaperProvider } from "paperui";
import "paperui/style.css";
import App from "./App";

render(
  () => (
    <PaperProvider theme="system" styleBody fullScreen>
      <App />
    </PaperProvider>
  ),
  document.getElementById("root")!
);
`}
            </PaperCode>
            <PaperQuote
                variant="monochrome"
                icon="book_5"
                title="Put a raincheck on that..."
            >
                You'll learn more about what the PaperProvider component can do
                later in the docs.
            </PaperQuote>
            <PaperText preset="body">
                That's it! You've successfully set up your first project with
                PaperUI.
            </PaperText>
        </>
    );
}
