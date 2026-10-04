export interface PanelFeature {
    title: string;
    description: string;
    image: string;
    alt: string;
}
export interface LearnPanel {
    slug: string;
    name: string;
    icon: string;
    accent: string;
    headline: string;
    description: string;
    summary: string;
    image: string;
    alt: string;
    features: PanelFeature[];
    note?: string;
}

// Editorial summaries of each panel's store/about.md. Keep claims aligned with
// the shipped panel; all pages, routes and related links come from this list.
export const LEARN_PANELS: LearnPanel[] = [
    {
        slug: "game-server",
        summary: "Dedicated Minecraft & game server manager",
        name: "Game Server",
        icon: "/pictures/game-server.png",
        accent: "var(--paper-panel-gameserver)",
        headline: "Minecraft, managed",
        description: "Run a Minecraft server. Manage players, worlds, and plugins in one place.",
        image: "/screens/gameserver.png",
        alt: "Game Server dashboard in Paperboard",
        features: [
            {
                title: "Choose your server",
                description:
                    "Pick Vanilla, Paper, or Fabric. Paperboard downloads the server and Java for you.",
                image: "/screens/gameserver-setup.png",
                alt: "Choose Minecraft server software and version",
            },
            {
                title: "Find your plugins",
                description:
                    "Search Modrinth, install plugins and mods, and keep them updated from the panel.",
                image: "/screens/gameserver-plugins.png",
                alt: "Game Server plugin and mod manager",
            },
            {
                title: "Manage your players",
                description:
                    "See player stats, manage the whitelist, and handle moderation. Connect server events to Actions workflows.",
                image: "/screens/gameserver-players.png",
                alt: "Minecraft player manager with online players and live stats",
            },
            {
                title: "Connect your panels",
                description:
                    "Send a Discord message when the server starts, or welcome new players with an Actions workflow.",
                image: "/screens/actions-library.png",
                alt: "Minecraft server startup and player join events connected to Discord actions",
            },
        ],
    },
    {
        slug: "actions",
        summary: "Visual automation and workflow builder",
        name: "Actions",
        icon: "/pictures/blocks.png",
        accent: "var(--paper-panel-actions)",
        headline: "Connect your panels",
        description:
            "Build workflows with triggers, action blocks, and results from your other panels.",
        image: "/screens/actions.png",
        alt: "Actions canvas with two working, non-overlapping flows",
        features: [
            {
                title: "Build a flow",
                description:
                    "Drag in blocks, pass their results to the next step, and press play to test.",
                image: "/screens/actions-flow.png",
                alt: "A complete text-processing flow with valid variable references",
            },
            {
                title: "Add your logic",
                description:
                    "Use calculations and conditions to decide what happens next. Check each step in the execution log.",
                image: "/screens/actions-logic.png",
                alt: "A complete calculation and conditional flow with its successful execution log",
            },
            {
                title: "Use your other panels",
                description:
                    "Send a Discord message when your Minecraft server starts. Use local AI in a workflow, or connect a service over HTTP.",
                image: "/screens/actions-library.png",
                alt: "Minecraft server events connected to Discord message actions",
            },
        ],
    },
    {
        slug: "bot-creator",
        summary: "Create and manage interactive Discord bots",
        name: "Bot Creator",
        icon: "/pictures/discord-bot.png",
        accent: "var(--paper-panel-botcreator)",
        headline: "Your Discord bot",
        description: "Manage your bot, commands, and Discord servers without writing code.",
        image: "/screens/botcreator.png",
        alt: "Bot Creator panel in Paperboard",
        features: [
            {
                title: "Connect your bot",
                description:
                    "Add your bot token to the vault. See its connection, activity, and recent messages.",
                image: "/screens/botcreator.png",
                alt: "Discord bot connection screen",
            },
            {
                title: "Create commands",
                description:
                    "Build slash commands and buttons. Use Actions for the logic behind them.",
                image: "/screens/botcreator-commands.png",
                alt: "Bot Creator slash command manager",
            },
            {
                title: "Browse your servers",
                description:
                    "See channels, members, and roles. Create invite links and connect your bot to other panels.",
                image: "/screens/botcreator-servers.png",
                alt: "Bot Creator server browser",
            },
        ],
        note: "You'll need a Discord application and a bot token to connect. Visual workflows use the Actions panel.",
    },
    {
        slug: "ai",
        summary: "Local language models with panel actions",
        name: "Local AI",
        icon: "/pictures/ai.png",
        accent: "var(--paper-panel-ai)",
        headline: "AI on your computer",
        description:
            "Run open-source models locally. Ask questions, work with files, and use panel tools.",
        image: "/screens/ai.png",
        alt: "AI chat panel in Paperboard",
        features: [
            {
                title: "Pick a model",
                description:
                    "Download and run open-source models through Ollama. Switch models for different tasks.",
                image: "/screens/ai-models.png",
                alt: "AI model picker and model management",
            },
            {
                title: "Understand your code",
                description:
                    "Ask for an explanation, spot a bug, or work with a file. Your local model processes the conversation.",
                image: "/screens/ai-code.png",
                alt: "Local AI explaining a Python script",
            },
            {
                title: "Plan something useful",
                description:
                    "Turn a rough idea into a plan. Enable web search or panel tools when the task needs them.",
                image: "/screens/ai-plan.png",
                alt: "Local AI planning a Minecraft server launch",
            },
        ],
        note: "Local models need disk space and RAM; a GPU is recommended. Optional web search sends search queries to DuckDuckGo.",
    },
];
