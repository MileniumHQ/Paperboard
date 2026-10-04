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
                    "Welcome players with a local AI message in Minecraft chat, then tell your Discord channel who joined. Build it in Actions.",
                image: "/screens/gameserver-actions.png",
                alt: "Player join trigger passing an AI welcome through a length limit to Minecraft chat and notifying Discord",
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
        alt: "Actions canvas announcing Minecraft startup and checking when the last player logs off",
        features: [
            {
                title: "Announce your server",
                description:
                    "Read the player count when Minecraft starts, build an announcement, and send your Discord channel the server address.",
                image: "/screens/actions-game-flow.png",
                alt: "Minecraft startup reading the live player count and composing a Discord announcement",
            },
            {
                title: "Welcome new members",
                description:
                    "Write a personal welcome with local AI, limit its length, send it as a direct message, and introduce the member in Discord.",
                image: "/screens/actions-discord-flow.png",
                alt: "Discord member join fields passed to local AI and a direct message, followed by a channel introduction",
            },
            {
                title: "Respond to AI events",
                description:
                    "Test a model when its download finishes. Ask for a building tip and send the model name and answer to Discord.",
                image: "/screens/actions-ai-flow.png",
                alt: "Newly downloaded model selected for an AI test and its shortened answer posted to Discord",
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
                    "Use Actions to acknowledge a Discord button, read Minecraft's player count and player list, and reply to the person who clicked.",
                image: "/screens/botcreator-actions.png",
                alt: "Discord status button deferred while Minecraft player count and player list are read, then answered privately",
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
                    "Filter Discord messages for !tip, ask your local model, limit the answer's length, and reply to the original message in Actions.",
                image: "/screens/ai-actions.png",
                alt: "Discord command condition followed by local AI, a reply length limit and a reply to the original message",
            },
        ],
        note: "Local models need disk space and RAM; a GPU is recommended. Optional web search sends search queries to DuckDuckGo.",
    },
];
