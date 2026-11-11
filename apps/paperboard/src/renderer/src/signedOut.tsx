// The page a browser without a session lands on (browserHost.ts): it says
// why, and how to get back in. Paperboard is the only way in, so there is
// no form here.
import "@mileniumhq/paperui/style.css";
import "./shell.css";
import { render } from "solid-js/web";
import { PaperCode, PaperEmptyState, PaperFlex, PaperProvider } from "@mileniumhq/paperui";

const WAYS_IN = (
    <>
        On the computer running Paperboard, choose “Open in Browser” from Paperboard's icon in the taskbar or menu bar, or run{" "}
        <PaperCode>paperboard --web</PaperCode>.
    </>
);

const REASONS: Record<string, { icon: string; title: string; why: string }> = {
    link: {
        icon: "link_off",
        title: "This sign-in link doesn't work anymore",
        why: "A sign-in link works once, for five minutes.",
    },
    ended: {
        icon: "logout",
        title: "This browser was signed out",
        why: "It signed out here or in another tab, or its sign-in expired after 30 days.",
    },
};
const SIGNED_OUT = { icon: "lock", title: "Open Paperboard from Paperboard", why: "This browser isn't signed in." };

function SignedOut() {
    const reason = REASONS[new URLSearchParams(location.search).get("reason") ?? ""] ?? SIGNED_OUT;
    return (
        <PaperProvider fullScreen>
            <PaperFlex center fullWidth fullHeight padding="double">
                <PaperEmptyState
                    icon={reason.icon}
                    title={reason.title}
                    description={
                        <>
                            {reason.why} {WAYS_IN}
                        </>
                    }
                />
            </PaperFlex>
        </PaperProvider>
    );
}

render(() => <SignedOut />, document.getElementById("root")!);
