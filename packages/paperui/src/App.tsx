import "./styles/styles.css";
import { PaperSelector, PaperSelectorItem } from "./components/PaperSelector";
import { PaperList, PaperListItem } from "./components/PaperList";
import { PaperRail, PaperRailItem } from "./components/PaperRail";
import { PaperEffect } from "./components/PaperEffect";
import { PaperButton } from "./components/PaperButton";
import { PaperSeparator } from "./components/PaperSeparator";
import { PaperText } from "./components/PaperText";
import { PaperLoader } from "./components/PaperLoader";
import { PaperIcon } from "./components/PaperIcon";
import {
    PaperWizard,
    PaperWizardStep,
    useWizard,
} from "./templates/PaperWizard";
import { PaperFlex } from "./templates/PaperFlex";
import {
    PaperInterfaceGroup,
    PaperInterfaceItem,
} from "./templates/PaperInterfaceGroup";
import { type LoaderStatus } from "./types";
import { createSignal, createEffect, onCleanup, Show, For } from "solid-js";
import { PaperInput } from "./components/PaperInput";
import { PaperMenu, PaperMenuItem } from "./components/PaperMenu";
import { PaperModal } from "./components/PaperModal";
import { PaperToggle } from "./components/PaperToggle";
import { PaperContainer } from "./components/PaperContainer";
import { PaperQuote } from "./components/PaperQuote";
import {
    PaperContextMenu,
    PaperContextMenuItem,
    PaperContextMenuSub,
    useContextMenuState,
} from "./components/PaperContextMenu";
import { PaperCode } from "./components/PaperCode";
import {
    PaperSettingList,
    PaperSettingItem,
} from "./templates/PaperSettingList";

function WizardStepThree(props: { envName: string }) {
    const wizard = useWizard();
    const [percent, setPercent] = createSignal(0);
    const [status, setStatus] = createSignal<LoaderStatus>("loading");

    createEffect(() => {
        if (!wizard || wizard.currentStep() !== 2) return;

        wizard.setOptionsShown(false);
        setPercent(0);
        setStatus("loading");

        let curr = 0;
        const timer = setInterval(() => {
            curr += 25;
            if (curr >= 100) {
                setPercent(100);
                clearInterval(timer);
                setTimeout(() => {
                    setStatus("success");
                    setTimeout(() => {
                        wizard.setOptionsShown(true);
                        wizard.setCanProceed(true);
                    }, 500);
                }, 400);
            } else {
                setPercent(curr);
            }
        }, 300);

        onCleanup(() => clearInterval(timer));
    });

    return (
        <PaperFlex
            gap="full"
            style={{ width: "100%", "align-items": "center" }}
        >
            <PaperText size={4} weight={600}>
                Deploying Workspace: {props.envName.toUpperCase()}
            </PaperText>
            <PaperLoader
                percent={percent()}
                loaderStatus={status()}
                label={
                    status() === "success"
                        ? "Deployment Complete!"
                        : "Initializing Pipeline..."
                }
            />
        </PaperFlex>
    );
}

export function App() {
    const [activeRail, setActiveRail] = createSignal("workspace-1");
    const [activeMenu, setActiveMenu] = createSignal("home");
    const [selectedEnv, setSelectedEnv] = createSignal("production");
    const [selectedList, setSelectedList] = createSignal("proj-alpha");
    const [activeDemoTab, setActiveDemoTab] = createSignal("overview");
    const [reorderItems, setReorderItems] = createSignal([
        { id: "overview", label: "Overview Item", icon: "dashboard" },
        { id: "analytics", label: "Analytics Item", icon: "analytics" },
        { id: "logs", label: "Logs Item", icon: "terminal" },
        { id: "settings", label: "Settings Item", icon: "settings" },
    ]);

    const handleCloseTab = (closedId: string) => {
        const current = reorderItems();
        const closedIndex = current.findIndex((item) => item.id === closedId);
        if (closedIndex < 0) return;

        if (activeDemoTab() === closedId) {
            if (closedIndex > 0) {
                setActiveDemoTab(current[closedIndex - 1].id);
            } else if (current.length > 1) {
                setActiveDemoTab(current[1].id);
            }
        }

        setReorderItems(current.filter((item) => item.id !== closedId));
    };

    const menuState = useContextMenuState();
    const [lastMenuAction, setLastMenuAction] = createSignal<string>("");
    const [pendingCloseTabId, setPendingCloseTabId] = createSignal<
        string | null
    >(null);

    const [completedData, setCompletedData] = createSignal<Record<
        string,
        any
    > | null>(null);

    const [loaderPercent, setLoaderPercent] = createSignal(65);
    const [loaderStatus, setLoaderStatus] =
        createSignal<LoaderStatus>("loading");
    const [isModalOpen, setIsModalOpen] = createSignal(false);
    const [isRichModalOpen, setIsRichModalOpen] = createSignal(false);
    const [modalName, setModalName] = createSignal("");
    const [toggleActive, setToggleActive] = createSignal(true);
    const [settingsJSON, setSettingsJSON] = createSignal<Record<string, any>>({
        darkMode: true,
        autoSave: true,
        workspaceName: "Paperboard Core Studio",
        notifications: false,
        unmatchedKey: "Ignored key that has no matching input name",
    });

    const mainHeader = () => (
        <PaperFlex gap="double">
            <PaperFlex direction="row" justify="space-between" align="center">
                <PaperFlex gap="onefourth">
                    <PaperText size={8} weight={800}>
                        PaperUI Interactive Studio
                    </PaperText>
                    <PaperText
                        size={3}
                        weight={500}
                        style={{ color: "var(--paper-light-text)" }}
                    >
                        SolidJS Component Library Test Workbench & Interactive
                        Showcase
                    </PaperText>
                </PaperFlex>

                <PaperEffect>
                    <PaperButton
                        variant="green"
                        onClick={() => setIsModalOpen(true)}
                    >
                        <PaperIcon>auto_awesome</PaperIcon>
                        Demo Modal
                    </PaperButton>
                </PaperEffect>
            </PaperFlex>
            <PaperSeparator />
        </PaperFlex>
    );

    return (
        <PaperFlex direction="row" style={{ width: "100vw", height: "100vh" }}>
            <PaperRail
                name="app-rail"
                value={activeRail()}
                onValueChange={(val) => setActiveRail(String(val))}
            >
                <PaperRailItem
                    value="workspace-1"
                    icon="dashboard"
                    label="Primary Studio"
                />
                <PaperRailItem
                    value="workspace-2"
                    icon="layers"
                    label="Templates"
                />
                <PaperRailItem
                    value="workspace-3"
                    icon="settings"
                    label="System Config"
                />
            </PaperRail>

            <PaperFlex direction="row" style={{ flex: 1, height: "100%" }}>
                <PaperMenu
                    name="main-menu"
                    value={activeMenu()}
                    onValueChange={(val) => setActiveMenu(String(val))}
                >
                    <PaperMenuItem
                        icon="home"
                        value="home"
                        description="Overview & main features"
                    >
                        Home Overview
                    </PaperMenuItem>
                    <PaperMenuItem
                        icon="auto_mode"
                        value="wizard"
                        description="Multi-step form wizard"
                    >
                        Full Screen Wizard
                    </PaperMenuItem>
                    <PaperMenuItem
                        icon="tune"
                        value="sandbox"
                        description="Interactive test sandbox"
                    >
                        Component Sandbox
                    </PaperMenuItem>
                    <PaperMenuItem
                        icon="checklist"
                        value="list-test"
                        description="List & Selection components"
                    >
                        PaperList & Selection
                    </PaperMenuItem>
                    <PaperMenuItem
                        icon="tab"
                        value="tabs"
                        description="Horizontal tab bar component"
                    >
                        Tabs Navigation
                    </PaperMenuItem>
                    <PaperMenuItem
                        icon="settings"
                        value="settings"
                        description="Workspace configuration"
                    >
                        Workspace Settings
                    </PaperMenuItem>
                </PaperMenu>

                <PaperInterfaceGroup
                    value={activeMenu()}
                    style={{ flex: 1, height: "100%" }}
                >
                    <PaperInterfaceItem value="wizard">
                        <PaperWizard
                            initialData={{
                                environment: "production",
                                appName: "Paperboard App",
                            }}
                            onStepChange={(idx, data) => {
                                console.log(`Step ${idx} changed:`, data);
                            }}
                            onComplete={(data) => {
                                setCompletedData(data);
                            }}
                        >
                            <PaperWizardStep
                                index={0}
                                title="1. Select Target Environment"
                            >
                                <PaperFlex
                                    gap="full"
                                    style={{
                                        "max-width": "640px",
                                        margin: "0 auto",
                                        padding: "24px",
                                    }}
                                >
                                    <PaperFlex
                                        gap="full"
                                        style={{ width: "100%" }}
                                    >
                                        <PaperText size={2} weight={500}>
                                            Target Workspace:{" "}
                                            <strong
                                                style={{
                                                    color: "var(--paper-front-blue)",
                                                }}
                                            >
                                                {selectedList().toUpperCase()}
                                            </strong>
                                        </PaperText>
                                        <PaperSelector
                                            name="environment"
                                            value={selectedEnv()}
                                            onValueChange={(val) =>
                                                setSelectedEnv(String(val))
                                            }
                                        >
                                            <PaperSelectorItem
                                                icon={
                                                    <PaperIcon monogram>
                                                        PR
                                                    </PaperIcon>
                                                }
                                                value="production"
                                                description="Global edge delivery with 99.99% uptime SLA"
                                            >
                                                Production Cloud Edge
                                            </PaperSelectorItem>
                                            <PaperSelectorItem
                                                icon={
                                                    <PaperIcon monogram>
                                                        ST
                                                    </PaperIcon>
                                                }
                                                value="staging"
                                                description="Internal testing container cluster with telemetry"
                                            >
                                                Staging Cluster
                                            </PaperSelectorItem>
                                            <PaperSelectorItem
                                                icon={
                                                    <PaperIcon monogram>
                                                        LO
                                                    </PaperIcon>
                                                }
                                                value="local"
                                                description="Isolated local development sandbox"
                                            >
                                                Local Sandbox
                                            </PaperSelectorItem>
                                        </PaperSelector>
                                    </PaperFlex>
                                </PaperFlex>
                            </PaperWizardStep>

                            <PaperWizardStep
                                index={1}
                                title="2. Configure Workspace Parameters"
                            >
                                <PaperFlex
                                    gap="full"
                                    style={{
                                        "max-width": "640px",
                                        margin: "0 auto",
                                        padding: "24px",
                                    }}
                                >
                                    <PaperFlex gap="onefourth">
                                        <PaperText size={2} weight={600}>
                                            Application Name:
                                        </PaperText>
                                        <PaperInput
                                            name="appName"
                                            value={selectedList()}
                                            placeholder="Enter app name"
                                        />
                                    </PaperFlex>

                                    <PaperFlex gap="onefourth">
                                        <PaperText size={2} weight={600}>
                                            Deployment Region:
                                        </PaperText>
                                        <PaperInput
                                            name="region"
                                            value="us-west-1 (Oregon)"
                                            placeholder="Enter region"
                                        />
                                    </PaperFlex>
                                </PaperFlex>
                            </PaperWizardStep>

                            <PaperWizardStep
                                index={2}
                                title="3. Review & Complete Setup"
                            >
                                <PaperFlex
                                    gap="full"
                                    style={{
                                        "max-width": "640px",
                                        margin: "0 auto",
                                        padding: "24px",
                                    }}
                                >
                                    <WizardStepThree envName={selectedEnv()} />

                                    <Show when={completedData()}>
                                        <PaperFlex
                                            gap="half"
                                            style={{
                                                padding: "16px",
                                                background:
                                                    "var(--paper-background-definition)",
                                                "border-radius":
                                                    "var(--paper-border-radius)",
                                                "border-left":
                                                    "4px solid var(--paper-green)",
                                            }}
                                        >
                                            <PaperText
                                                size={3}
                                                weight={700}
                                                style={{
                                                    color: "var(--paper-green)",
                                                }}
                                            >
                                                Setup Finished!
                                            </PaperText>
                                            <pre
                                                style={{
                                                    margin: "8px 0 0 0",
                                                    "font-family":
                                                        "SUSE Mono, monospace",
                                                }}
                                            >
                                                {JSON.stringify(
                                                    completedData(),
                                                    null,
                                                    2,
                                                )}
                                            </pre>
                                        </PaperFlex>
                                    </Show>
                                </PaperFlex>
                            </PaperWizardStep>
                        </PaperWizard>
                    </PaperInterfaceItem>

                    <PaperInterfaceItem value="home">
                        <PaperFlex
                            gap="double"
                            style={{
                                padding: "28px",
                                height: "100%",
                                "overflow-y": "auto",
                            }}
                        >
                            {mainHeader()}
                            <PaperFlex gap="full">
                                <PaperText size={5} weight={700}>
                                    Home Overview & Input Showcase
                                </PaperText>
                                <PaperText
                                    size={2}
                                    weight={500}
                                    style={{ color: "var(--paper-light-text)" }}
                                >
                                    Demonstrating PaperInput, PaperToggle, and
                                    PaperButton color variants.
                                </PaperText>

                                <PaperFlex
                                    direction="row"
                                    align="center"
                                    gap="full"
                                >
                                    <PaperInput
                                        placeholder="Meow"
                                        style={{ flex: 1 }}
                                    />
                                    <PaperFlex
                                        direction="row"
                                        align="center"
                                        gap="half"
                                    >
                                        <PaperToggle
                                            checked={toggleActive()}
                                            onChange={setToggleActive}
                                        />
                                        <PaperText size={2} weight={600}>
                                            Toggle:{" "}
                                            {toggleActive() ? "ON" : "OFF"}
                                        </PaperText>
                                    </PaperFlex>
                                </PaperFlex>

                                <PaperFlex
                                    direction="row"
                                    gap="half"
                                    wrap
                                    align="center"
                                >
                                    <PaperEffect>
                                        <PaperButton variant="blue">
                                            Blue Variant
                                        </PaperButton>
                                    </PaperEffect>
                                    <PaperEffect>
                                        <PaperButton variant="green">
                                            Green Variant
                                        </PaperButton>
                                    </PaperEffect>
                                    <PaperEffect>
                                        <PaperButton variant="yellow">
                                            Yellow Variant
                                        </PaperButton>
                                    </PaperEffect>
                                    <PaperEffect>
                                        <PaperButton variant="red">
                                            Red Variant
                                        </PaperButton>
                                    </PaperEffect>
                                    <PaperEffect>
                                        <PaperButton variant="text">
                                            Text Variant
                                        </PaperButton>
                                    </PaperEffect>
                                    <PaperEffect>
                                        <PaperButton compact variant="brand">
                                            Compact Button
                                        </PaperButton>
                                    </PaperEffect>
                                    <PaperEffect>
                                        <PaperButton
                                            compact
                                            variant="green"
                                            onClick={() =>
                                                setIsRichModalOpen(true)
                                            }
                                        >
                                            <PaperIcon>
                                                space_dashboard
                                            </PaperIcon>
                                            Open Rich Dashboard Modal
                                        </PaperButton>
                                    </PaperEffect>
                                    <PaperButton tiny icon>
                                        close
                                    </PaperButton>
                                </PaperFlex>
                            </PaperFlex>
                        </PaperFlex>
                    </PaperInterfaceItem>

                    <PaperInterfaceItem value="sandbox">
                        <PaperFlex
                            gap="double"
                            style={{
                                padding: "28px",
                                height: "100%",
                                "overflow-y": "auto",
                            }}
                        >
                            {mainHeader()}
                            <PaperFlex gap="double">
                                <PaperText size={5} weight={700}>
                                    Component Stress Test Sandbox
                                </PaperText>

                                <PaperFlex gap="half">
                                    <PaperText size={4} weight={600}>
                                        1. PaperLoader Component Controls
                                    </PaperText>

                                    <PaperFlex
                                        direction="row"
                                        align="center"
                                        gap="full"
                                    >
                                        <PaperLoader
                                            percent={loaderPercent()}
                                            loaderStatus={loaderStatus()}
                                            label={`Status: ${loaderStatus()} (${loaderPercent()}%)`}
                                        />
                                    </PaperFlex>

                                    <PaperFlex direction="row" gap="half" wrap>
                                        <PaperEffect>
                                            <PaperButton
                                                onClick={() =>
                                                    setLoaderStatus("loading")
                                                }
                                            >
                                                Set Loading
                                            </PaperButton>
                                        </PaperEffect>
                                        <PaperEffect>
                                            <PaperButton
                                                onClick={() =>
                                                    setLoaderStatus("success")
                                                }
                                            >
                                                Set Success
                                            </PaperButton>
                                        </PaperEffect>
                                        <PaperEffect>
                                            <PaperButton
                                                onClick={() =>
                                                    setLoaderStatus("error")
                                                }
                                            >
                                                Set Error
                                            </PaperButton>
                                        </PaperEffect>
                                        <PaperEffect colorless>
                                            <PaperButton
                                                onClick={() =>
                                                    setLoaderStatus("waiting")
                                                }
                                            >
                                                Set Waiting
                                            </PaperButton>
                                        </PaperEffect>
                                        <PaperEffect colorless>
                                            <PaperButton
                                                onClick={() =>
                                                    setLoaderPercent((p) =>
                                                        p >= 100 ? 10 : p + 20,
                                                    )
                                                }
                                            >
                                                +20% Progress
                                            </PaperButton>
                                        </PaperEffect>
                                    </PaperFlex>
                                </PaperFlex>

                                <PaperSeparator />

                                <PaperFlex gap="half">
                                    <PaperText size={4} weight={600}>
                                        2. PaperText Typography Scale (size 1 to
                                        11)
                                    </PaperText>

                                    <PaperFlex gap="onefourth">
                                        <PaperText size={11} weight={800}>
                                            Size 11: Heavy Headline
                                        </PaperText>
                                        <PaperText size={8} weight={700}>
                                            Size 8: Section Header
                                        </PaperText>
                                        <PaperText size={5} weight={600}>
                                            Size 5: Subheading Title
                                        </PaperText>
                                        <PaperText size={3} weight={500}>
                                            Size 3: Standard Body Text
                                        </PaperText>
                                        <PaperText
                                            size={1}
                                            weight={600}
                                            style={{
                                                color: "var(--paper-light-text)",
                                            }}
                                        >
                                            Size 1: Micro Description & Caption
                                        </PaperText>
                                    </PaperFlex>
                                </PaperFlex>
                            </PaperFlex>
                        </PaperFlex>
                    </PaperInterfaceItem>

                    <PaperInterfaceItem value="list-test">
                        <PaperFlex
                            direction="row"
                            style={{ width: "100%", height: "100%" }}
                        >
                            <PaperFlex
                                resizable
                                direction="row"
                                style={{
                                    "min-width": "220px",
                                    "max-width": "420px",
                                }}
                            >
                                <PaperList
                                    name="project-list"
                                    value={selectedList()}
                                    onValueChange={(val) =>
                                        setSelectedList(String(val))
                                    }
                                    style={{ width: "100%" }}
                                >
                                    <PaperListItem
                                        icon={
                                            <PaperIcon monogram>PA</PaperIcon>
                                        }
                                        value="proj-alpha"
                                        description="Main production pipeline"
                                    >
                                        Project Alpha
                                    </PaperListItem>
                                    <PaperListItem
                                        icon={
                                            <PaperIcon monogram>PB</PaperIcon>
                                        }
                                        value="proj-beta"
                                        description="Staging & experimentation"
                                    >
                                        Project Beta
                                    </PaperListItem>
                                    <PaperListItem
                                        icon={
                                            <PaperIcon monogram>LA</PaperIcon>
                                        }
                                        value="proj-archive"
                                        description="Archived releases & logs"
                                    >
                                        Legacy Archives
                                    </PaperListItem>
                                </PaperList>
                            </PaperFlex>

                            <PaperFlex
                                gap="double"
                                style={{
                                    flex: 1,
                                    padding: "28px",
                                    height: "100%",
                                    "overflow-y": "auto",
                                }}
                            >
                                {mainHeader()}
                                <PaperFlex gap="full">
                                    <PaperText size={5} weight={700}>
                                        PaperList & Selection Test
                                    </PaperText>
                                    <PaperText
                                        size={2}
                                        weight={500}
                                        style={{
                                            color: "var(--paper-light-text)",
                                        }}
                                    >
                                        Active List Selection:{" "}
                                        <strong>{selectedList()}</strong>
                                    </PaperText>

                                    <PaperList
                                        direction="horizontal"
                                        name="list-test-horizontal"
                                        value={selectedList()}
                                        onValueChange={(val) =>
                                            setSelectedList(String(val))
                                        }
                                    >
                                        <PaperListItem
                                            icon="rocket_launch"
                                            value="proj-alpha"
                                            description="Production branch"
                                        >
                                            Project Alpha List Item
                                        </PaperListItem>
                                        <PaperListItem
                                            icon="science"
                                            value="proj-beta"
                                            description="Staging branch"
                                        >
                                            Project Beta List Item
                                        </PaperListItem>
                                        <PaperListItem
                                            icon="folder_zip"
                                            value="proj-archive"
                                            description="Archived release"
                                        >
                                            Legacy Archive List Item
                                        </PaperListItem>
                                    </PaperList>

                                    <PaperSelector
                                        name="list-test-selector"
                                        value={selectedList()}
                                        onValueChange={(val) =>
                                            setSelectedList(String(val))
                                        }
                                    >
                                        <PaperSelectorItem
                                            icon="rocket_launch"
                                            value="proj-alpha"
                                            description="Production branch"
                                        >
                                            Project Alpha Card
                                        </PaperSelectorItem>
                                        <PaperSelectorItem
                                            icon="science"
                                            value="proj-beta"
                                            description="Staging branch"
                                        >
                                            Project Beta Card
                                        </PaperSelectorItem>
                                        <PaperSelectorItem
                                            icon="folder_zip"
                                            value="proj-archive"
                                            description="Archived release"
                                        >
                                            Legacy Archive Card
                                        </PaperSelectorItem>
                                    </PaperSelector>
                                </PaperFlex>
                            </PaperFlex>
                        </PaperFlex>
                    </PaperInterfaceItem>

                    <PaperInterfaceItem value="tabs">
                        <PaperFlex
                            gap="double"
                            style={{
                                padding: "28px",
                                height: "100%",
                                "overflow-y": "auto",
                            }}
                        >
                            {mainHeader()}
                            <PaperFlex gap="full">
                                <PaperText size={5} weight={700}>
                                    Horizontal Navigation & Layout Showcase
                                </PaperText>
                                <PaperText
                                    size={2}
                                    weight={500}
                                    style={{ color: "var(--paper-light-text)" }}
                                >
                                    PaperMenu and PaperList operating in
                                    horizontal mode (`direction="horizontal"`).
                                </PaperText>

                                <PaperText
                                    size={3}
                                    weight={600}
                                    style={{ "margin-top": "12px" }}
                                >
                                    1. Horizontal PaperMenu (Tab Navigation)
                                </PaperText>
                                <PaperMenu
                                    direction="horizontal"
                                    name="demo-horizontal-menu"
                                    value={activeDemoTab()}
                                    onValueChange={(val) =>
                                        setActiveDemoTab(String(val))
                                    }
                                >
                                    <PaperMenuItem
                                        icon="dashboard"
                                        value="overview"
                                    >
                                        Overview
                                    </PaperMenuItem>
                                    <PaperMenuItem
                                        icon="analytics"
                                        value="analytics"
                                    >
                                        Analytics
                                    </PaperMenuItem>
                                    <PaperMenuItem icon="terminal" value="logs">
                                        Logs
                                    </PaperMenuItem>
                                    <PaperMenuItem
                                        icon="settings"
                                        value="settings"
                                    >
                                        Settings
                                    </PaperMenuItem>
                                </PaperMenu>

                                <PaperText
                                    size={3}
                                    weight={600}
                                    style={{ "margin-top": "16px" }}
                                >
                                    2. Reorderable Horizontal PaperList with Tab
                                    Closing & Modal Prevention (Try closing
                                    'Logs' or 'Settings' to trigger confirmation
                                    modal!)
                                </PaperText>
                                <PaperList
                                    reorderable
                                    direction="horizontal"
                                    name="demo-horizontal-list"
                                    value={activeDemoTab()}
                                    onValueChange={(val) =>
                                        setActiveDemoTab(String(val))
                                    }
                                    onReorder={(newOrder) => {
                                        const current = reorderItems();
                                        const reordered = newOrder
                                            .map(
                                                (id) =>
                                                    current.find(
                                                        (item) =>
                                                            item.id === id,
                                                    )!,
                                            )
                                            .filter(Boolean);
                                        setReorderItems(reordered);
                                    }}
                                >
                                    <For each={reorderItems()}>
                                        {(item) => (
                                            <PaperListItem
                                                icon={item.icon}
                                                value={item.id}
                                                onBeforeClose={(e) => {
                                                    if (
                                                        item.id === "logs" ||
                                                        item.id === "settings"
                                                    ) {
                                                        e.preventDefault();
                                                        setPendingCloseTabId(
                                                            item.id,
                                                        );
                                                    }
                                                }}
                                                onClosed={(closedId) => {
                                                    handleCloseTab(
                                                        String(closedId),
                                                    );
                                                }}
                                            >
                                                {item.label}
                                            </PaperListItem>
                                        )}
                                    </For>
                                </PaperList>

                                <PaperModal
                                    open={pendingCloseTabId() !== null}
                                    onClose={() => setPendingCloseTabId(null)}
                                    title="Confirm Tab Closure"
                                >
                                    <PaperFlex gap="double">
                                        <PaperText size={3}>
                                            Are you sure you want to close the
                                            tab{" "}
                                            <strong>
                                                {pendingCloseTabId()}
                                            </strong>
                                            ? Unsaved changes may be lost.
                                        </PaperText>
                                        <PaperFlex
                                            direction="row"
                                            justify="flex-end"
                                            gap="full"
                                        >
                                            <PaperButton
                                                variant="text"
                                                onClick={() =>
                                                    setPendingCloseTabId(null)
                                                }
                                            >
                                                Cancel
                                            </PaperButton>
                                            <PaperButton
                                                variant="red"
                                                onClick={() => {
                                                    const id =
                                                        pendingCloseTabId();
                                                    if (id) handleCloseTab(id);
                                                    setPendingCloseTabId(null);
                                                }}
                                            >
                                                Close Tab
                                            </PaperButton>
                                        </PaperFlex>
                                    </PaperFlex>
                                </PaperModal>

                                <PaperContainer
                                    style={{
                                        padding: "24px",
                                        "margin-top": "16px",
                                    }}
                                >
                                    <Show when={activeDemoTab() === "overview"}>
                                        <PaperText size={4} weight={600}>
                                            📊 Overview Panel
                                        </PaperText>
                                        <PaperText
                                            size={2}
                                            weight={400}
                                            style={{
                                                color: "var(--paper-light-text)",
                                                "margin-top": "8px",
                                            }}
                                        >
                                            Welcome to the Paperboard overview
                                            dashboard.
                                        </PaperText>
                                    </Show>

                                    <Show
                                        when={activeDemoTab() === "analytics"}
                                    >
                                        <PaperText size={4} weight={600}>
                                            📈 Analytics & Performance Metrics
                                        </PaperText>
                                        <PaperText
                                            size={2}
                                            weight={400}
                                            style={{
                                                color: "var(--paper-light-text)",
                                                "margin-top": "8px",
                                            }}
                                        >
                                            Real-time traffic and render latency
                                            reports.
                                        </PaperText>
                                    </Show>

                                    <Show when={activeDemoTab() === "logs"}>
                                        <PaperText size={4} weight={600}>
                                            💻 System Event Logs
                                        </PaperText>
                                        <PaperCode
                                            block
                                            style={{ "margin-top": "8px" }}
                                        >
                                            {
                                                "[INFO] 11:46:00 - Horizontal PaperMenu & PaperList rendered successfully\n[DEBUG] activeTab = 'logs'"
                                            }
                                        </PaperCode>
                                    </Show>

                                    <Show when={activeDemoTab() === "settings"}>
                                        <PaperText size={4} weight={600}>
                                            ⚙️ Tab Panel Settings
                                        </PaperText>
                                        <PaperText
                                            size={2}
                                            weight={400}
                                            style={{
                                                color: "var(--paper-light-text)",
                                                "margin-top": "8px",
                                            }}
                                        >
                                            Configure active panel behavior.
                                        </PaperText>
                                    </Show>
                                </PaperContainer>

                                <PaperText
                                    size={3}
                                    weight={600}
                                    style={{ "margin-top": "24px" }}
                                >
                                    3. PaperContextMenu (Right-click box or
                                    press three-dot button, supports keybinds,
                                    submenus & auto-flip!)
                                </PaperText>

                                <PaperContainer
                                    onContextMenu={menuState.openAtMouse}
                                    style={{
                                        padding: "24px",
                                        "margin-top": "12px",
                                        border: "var(--paper-border-width) dashed var(--paper-medium-border)",
                                        cursor: "context-menu",
                                        display: "flex",
                                        "flex-direction": "column",
                                        gap: "12px",
                                        background:
                                            "color-mix(in srgb, var(--paper-anti-background) 2%, var(--paper-background-frontest))",
                                    }}
                                >
                                    <PaperFlex
                                        direction="row"
                                        justify="space-between"
                                        align="center"
                                    >
                                        <PaperFlex gap="onefourth">
                                            <PaperText size={3} weight={700}>
                                                Context Menu Target Zone
                                            </PaperText>
                                            <PaperText
                                                size={2}
                                                weight={400}
                                                style={{
                                                    color: "var(--paper-light-text)",
                                                }}
                                            >
                                                Right-click anywhere inside this
                                                box (mouse preset), or click the
                                                button (below-right preset)!
                                            </PaperText>
                                        </PaperFlex>
                                        <PaperButton
                                            tiny
                                            icon
                                            onClick={(e) =>
                                                menuState.openBelow(e, {
                                                    align: "right",
                                                })
                                            }
                                        >
                                            more_vert
                                        </PaperButton>
                                    </PaperFlex>

                                    <Show when={lastMenuAction()}>
                                        <PaperText
                                            size={2}
                                            weight={600}
                                            style={{
                                                color: "var(--paper-front-blue)",
                                            }}
                                        >
                                            Last Action Triggered:{" "}
                                            {lastMenuAction()}
                                        </PaperText>
                                    </Show>
                                </PaperContainer>

                                <PaperContextMenu
                                    open={menuState.isOpen()}
                                    target={menuState.target()}
                                    placement={menuState.placement()}
                                    onClose={menuState.close}
                                >
                                    <PaperContextMenuItem
                                        icon="content_copy"
                                        keybind="⌘C"
                                        onClick={() =>
                                            setLastMenuAction(
                                                "Copied Item (⌘C)",
                                            )
                                        }
                                    >
                                        Copy Item
                                    </PaperContextMenuItem>
                                    <PaperContextMenuItem
                                        icon="content_cut"
                                        keybind="⌘X"
                                        onClick={() =>
                                            setLastMenuAction("Cut Item (⌘X)")
                                        }
                                    >
                                        Cut Item
                                    </PaperContextMenuItem>
                                    <PaperContextMenuItem
                                        icon="content_paste"
                                        keybind="⌘V"
                                        onClick={() =>
                                            setLastMenuAction(
                                                "Pasted Item (⌘V)",
                                            )
                                        }
                                    >
                                        Paste Item
                                    </PaperContextMenuItem>

                                    <PaperSeparator />

                                    <PaperContextMenuSub
                                        label="Share & Export"
                                        icon="share"
                                    >
                                        <PaperContextMenuItem
                                            icon="mail"
                                            onClick={() =>
                                                setLastMenuAction(
                                                    "Sent via Email",
                                                )
                                            }
                                        >
                                            Send via Email
                                        </PaperContextMenuItem>
                                        <PaperContextMenuItem
                                            icon="link"
                                            keybind="Ctrl+L"
                                            onClick={() =>
                                                setLastMenuAction(
                                                    "Copied Direct Link",
                                                )
                                            }
                                        >
                                            Copy Direct Link
                                        </PaperContextMenuItem>
                                        <PaperContextMenuItem
                                            icon="picture_as_pdf"
                                            onClick={() =>
                                                setLastMenuAction(
                                                    "Exported PDF Document",
                                                )
                                            }
                                        >
                                            Export PDF Document
                                        </PaperContextMenuItem>
                                    </PaperContextMenuSub>

                                    <PaperSeparator />
                                    <PaperContextMenuItem
                                        icon="delete"
                                        keybind="Del"
                                        danger
                                        onClick={() =>
                                            setLastMenuAction(
                                                "Deleted Item (Del)",
                                            )
                                        }
                                    >
                                        Delete Item
                                    </PaperContextMenuItem>
                                </PaperContextMenu>
                            </PaperFlex>
                        </PaperFlex>
                    </PaperInterfaceItem>

                    <PaperInterfaceItem value="settings">
                        <PaperFlex
                            gap="double"
                            style={{
                                padding: "28px",
                                height: "100%",
                                "overflow-y": "auto",
                            }}
                        >
                            {mainHeader()}
                            <PaperFlex gap="full">
                                <PaperText size={5} weight={700}>
                                    Workspace Settings
                                </PaperText>
                                <PaperText
                                    size={2}
                                    weight={500}
                                    style={{ color: "var(--paper-light-text)" }}
                                >
                                    Configure local theme properties and
                                    component defaults.
                                </PaperText>

                                <PaperQuote
                                    variant="blue"
                                    icon="info"
                                    title="Workspace Information"
                                >
                                    Changes saved below apply immediately across
                                    all active canvas sessions and collaborative
                                    teammates.
                                </PaperQuote>

                                <PaperContainer>
                                    <PaperSettingList
                                        value={settingsJSON()}
                                        onValueChange={(newVal) =>
                                            setSettingsJSON(newVal)
                                        }
                                    >
                                        <PaperSettingItem
                                            title="Dark Mode"
                                            description="Enable dark mode interface theme across workspace"
                                        >
                                            <PaperToggle name="darkMode" />
                                        </PaperSettingItem>

                                        <PaperSettingItem
                                            title="Workspace Title"
                                            description="Public title for this paperboard environment"
                                        >
                                            <PaperInput
                                                name="workspaceName"
                                                placeholder="Enter workspace title"
                                            />
                                        </PaperSettingItem>

                                        <PaperSettingItem
                                            title="Auto-Save Progress"
                                            description="Automatically persist canvas changes to local storage"
                                        >
                                            <PaperToggle name="autoSave" />
                                        </PaperSettingItem>

                                        <PaperSettingItem
                                            title="Push Notifications"
                                            description="Receive desktop alerts on build deployments"
                                        >
                                            <PaperToggle name="notifications" />
                                        </PaperSettingItem>
                                    </PaperSettingList>
                                </PaperContainer>

                                <PaperQuote
                                    variant="monochrome"
                                    icon="lightbulb"
                                    title="Developer Tip"
                                >
                                    PaperSettingList is borderless by default.
                                    Wrap it inside{" "}
                                    <PaperCode>
                                        &lt;PaperContainer&gt;
                                    </PaperCode>{" "}
                                    when you want a card border!
                                </PaperQuote>

                                <PaperFlex
                                    gap="half"
                                    style={{ "margin-top": "8px" }}
                                >
                                    <PaperText size={2} weight={700}>
                                        Reactive Settings JSON Output:
                                    </PaperText>
                                    <pre
                                        style={{
                                            margin: 0,
                                            padding: "12px",
                                            background:
                                                "var(--paper-background-front)",
                                            "border-radius":
                                                "var(--paper-border-radius)",
                                            "font-family":
                                                "SUSE Mono, monospace",
                                            "font-size": "12px",
                                        }}
                                    >
                                        {JSON.stringify(
                                            settingsJSON(),
                                            null,
                                            2,
                                        )}
                                    </pre>
                                </PaperFlex>
                            </PaperFlex>
                        </PaperFlex>
                    </PaperInterfaceItem>
                </PaperInterfaceGroup>
            </PaperFlex>

            <PaperModal
                open={isModalOpen()}
                onClose={() => setIsModalOpen(false)}
                title="Interactive PaperModal Showcase"
                size="medium"
                footer={
                    <>
                        <PaperButton
                            variant="text"
                            onClick={() => setIsModalOpen(false)}
                        >
                            Cancel
                        </PaperButton>
                        <PaperEffect>
                            <PaperButton
                                variant="green"
                                onClick={() => {
                                    alert(
                                        `Action confirmed for: ${modalName() || "Anonymous Workspace"}`,
                                    );
                                    setIsModalOpen(false);
                                }}
                            >
                                <PaperIcon>check</PaperIcon>
                                Confirm Action
                            </PaperButton>
                        </PaperEffect>
                    </>
                }
            >
                <PaperFlex gap="full">
                    <PaperText size={3} weight={600}>
                        Enter Configuration Details
                    </PaperText>
                    <PaperText
                        size={2}
                        weight={400}
                        style={{ color: "var(--paper-light-text)" }}
                    >
                        This modal demonstrates built-in glassmorphic backdrop
                        blurring, ESC key closing, backdrop click dismissal, and
                        standard Paper design tokens.
                    </PaperText>

                    <PaperInput
                        placeholder="Type a custom name..."
                        value={modalName()}
                        onInput={(e) => setModalName(e.currentTarget.value)}
                    />
                </PaperFlex>
            </PaperModal>

            <PaperModal
                open={isRichModalOpen()}
                onClose={() => setIsRichModalOpen(false)}
                title="Workspace Pipeline Dashboard"
                size="large"
                footer={
                    <>
                        <PaperButton
                            compact
                            variant="text"
                            onClick={() => setIsRichModalOpen(false)}
                        >
                            Dismiss
                        </PaperButton>
                        <PaperEffect>
                            <PaperButton
                                compact
                                variant="green"
                                onClick={() => {
                                    alert("Pipeline Deployment Initiated!");
                                    setIsRichModalOpen(false);
                                }}
                            >
                                <PaperIcon>rocket_launch</PaperIcon>
                                Deploy Release
                            </PaperButton>
                        </PaperEffect>
                    </>
                }
            >
                <PaperFlex gap="double">
                    <PaperQuote
                        variant="brand"
                        icon="stars"
                        title="Production Cluster v2.4"
                    >
                        Deployment will initiate automated integration testing
                        and sync asset bundles across regional edge networks.
                    </PaperQuote>

                    <PaperContainer>
                        <PaperSettingList
                            defaultValue={{
                                autoDeploy: true,
                                environment: "production-main",
                                notifications: true,
                            }}
                        >
                            <PaperSettingItem
                                title="Automated Continuous Deployment"
                                description="Automatically promote verified builds from staging branch"
                            >
                                <PaperToggle name="autoDeploy" />
                            </PaperSettingItem>

                            <PaperSettingItem
                                title="Release Target Branch"
                                description="Primary git branch for asset bundling and deployment"
                            >
                                <PaperInput
                                    name="environment"
                                    placeholder="main"
                                />
                            </PaperSettingItem>

                            <PaperSettingItem
                                title="Deployment Alerts"
                                description="Notify Slack channel on successful production release"
                            >
                                <PaperToggle name="notifications" />
                            </PaperSettingItem>
                        </PaperSettingList>
                    </PaperContainer>
                </PaperFlex>
            </PaperModal>
        </PaperFlex>
    );
}
