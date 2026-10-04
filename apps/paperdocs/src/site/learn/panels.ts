export interface PanelFeature {
    title: string;
    description: string;
    image: string;
    alt: string;
}
export interface LearnPanel {
    slug: string;
    name: string;
    seoTitle: string;
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
        seoTitle: "Minecraft server manager | Paperboard",
        icon: "/pictures/game-server.png",
        accent: "var(--paper-panel-gameserver)",
        headline: "Minecraft, managed",
        description: "Run a Minecraft server. Manage players, worlds, and plugins in one place.",
        image: "/screens/learn-gameserver.png",
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
                image: "/screens/gameserver-actions.png",
                alt: "Minecraft server startup and player join events connected to Discord actions",
            },
        ],
    },
    {
        slug: "actions",
        summary: "Visual automation and workflow builder",
        name: "Actions",
        seoTitle: "Visual workflow automation | Paperboard",
        icon: "/pictures/blocks.png",
        accent: "var(--paper-panel-actions)",
        headline: "Connect your panels",
        description:
            "Build workflows with triggers, action blocks, and results from your other panels.",
        image: "/screens/actions-overview.png",
        alt: "Actions canvas with Discord member welcomes and local AI download notifications",
        features: [
            {
                title: "Announce your server",
                description:
                    "Connect Minecraft server events to Discord. Let your friends know when the server is ready.",
                image: "/screens/actions-game-flow.png",
                alt: "Minecraft server started trigger connected to a Discord message block",
            },
            {
                title: "Welcome new members",
                description:
                    "Send new Discord members a direct message with your server address, and introduce them to the welcome channel.",
                image: "/screens/actions-discord-flow.png",
                alt: "Discord member join event connected to a direct message and channel welcome",
            },
            {
                title: "Respond to AI events",
                description:
                    "Notify a Discord channel when a local AI model finishes downloading. Use panel events to connect your tools.",
                image: "/screens/actions-ai-flow.png",
                alt: "AI model download completion connected to a Discord notification",
            },
        ],
    },
    {
        slug: "bot-creator",
        summary: "Create and manage interactive Discord bots",
        name: "Bot Creator",
        seoTitle: "Discord bot builder and automation | Paperboard",
        icon: "/pictures/discord-bot.png",
        accent: "var(--paper-panel-botcreator)",
        headline: "Give your bot something to do",
        description: "Build your bot’s behavior in Actions. Connect Discord commands and buttons to your other panels.",
        image: "/screens/learn-botcreator.png",
        alt: "Bot Creator panel in Paperboard",
        features: [
            {
                title: "Build its behavior",
                description:
                    "Use Actions to handle a Discord button, call another panel, and send a reply. Your bot becomes the way in to your tools.",
                image: "/screens/botcreator-actions.png",
                alt: "Actions workflow connecting a Discord button to a Minecraft announcement and reply",
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
        seoTitle: "Local AI chat and automation | Paperboard",
        icon: "/pictures/ai.png",
        accent: "var(--paper-panel-ai)",
        headline: "AI on your computer",
        description:
            "Run open-source models locally. Ask questions, work with files, and use panel tools.",
        image: "/screens/learn-ai.png",
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
                title: "Use AI in a workflow",
                description:
                    "Ask your local model from Actions and pass the answer to another panel, such as a welcome message in Minecraft.",
                image: "/screens/ai-actions.png",
                alt: "Actions asking local AI for a welcome and passing its answer to Minecraft chat",
            },
        ],
        note: "Local models need disk space and RAM; a GPU is recommended. Optional web search sends search queries to DuckDuckGo.",
    },
];
