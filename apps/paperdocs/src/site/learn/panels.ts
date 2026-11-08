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
    /** where the headline may wrap; every panel's headline is set at one size */
    headlineLines: string[];
    description: string;
    summary: string;
    image: string;
    alt: string;
    features: PanelFeature[];
    note?: string;
}

// Editorial summaries of each panel's store/about.md. Keep claims aligned with
// the shipped panel; all pages, routes and related links come from this list,
// in this order: the site lists the panels this way everywhere.
export const LEARN_PANELS: LearnPanel[] = [
    {
        slug: "agents",
        summary: "An agent you text, with a computer of its own",
        name: "Agent",
        seoTitle: "Your own AI agent | Paperboard",
        icon: "/pictures/agents.png",
        accent: "var(--paper-panel-agents)",
        headline: "An agent you text",
        headlineLines: ["An agent", "you text"],
        description:
            "Text it like a friend. It makes you apps, browses the web, and remembers what matters to you.",
        image: "/screens/agents-1.png",
        alt: "Texting your agent, with an app it made for you",
        features: [
            {
                title: "It makes you apps",
                description:
                    "Ask for a planner, a tracker, or a list, and it builds a small app that opens beside the chat.",
                image: "/screens/agents-2.png",
                alt: "An app the agent made, open beside the chat",
            },
            {
                title: "It has a computer of its own",
                description:
                    "It browses the web in its own browser, which you can watch and use yourself. It only opens public websites, never your computer or local network.",
                image: "/screens/agents-3.png",
                alt: "The agent's computer, a web browser you can watch and use",
            },
            {
                title: "It keeps your routines",
                description:
                    "Ask for a reminder or a daily check-in, and it runs on a schedule you can see and delete.",
                image: "/screens/agents-6.png",
                alt: "Routines: what the agent does on a schedule",
            },
            {
                title: "Use it in your flows",
                description:
                    "Ask your agent from any Actions flow and use its answer. Here, it posts a build challenge in Minecraft chat whenever the server starts.",
                image: "/screens/agents-flow.png",
                alt: "A server start asking the agent for a build challenge and saying it in Minecraft chat",
            },
        ],
        note: "You'll need a Codex, Claude, or OpenCode account. OpenCode also has free models.",
    },
    {
        slug: "game-server",
        summary: "Servers for Minecraft, Terraria, Palworld & TF2",
        name: "Game Server",
        seoTitle: "Game server manager for Minecraft, Terraria and more | Paperboard",
        icon: "/pictures/game-server.png",
        accent: "var(--paper-panel-gameserver)",
        headline: "Game night, hosted",
        headlineLines: ["Game night,", "hosted"],
        description:
            "Run servers for Minecraft, Terraria, Palworld and Team Fortress 2 on your own computer. Pick a game, and your friends can join in minutes.",
        image: "/screens/gameserver-1.png",
        alt: "Servers for Minecraft, Terraria, Palworld and Team Fortress 2",
        features: [
            {
                title: "Watch it live",
                description:
                    "Start, stop, and talk to a server from its overview, with its console and players right there.",
                image: "/screens/gameserver-2.png",
                alt: "A Minecraft server's overview and live console",
            },
            {
                title: "See your world",
                description: "Explore a live map of your Minecraft world while people play.",
                image: "/screens/gameserver-3.png",
                alt: "Live map of a Minecraft world",
            },
            {
                title: "Manage your players",
                description: "See player stats, manage the whitelist, and handle moderation.",
                image: "/screens/gameserver-4.png",
                alt: "Players with their stats, whitelist and operator controls",
            },
            {
                title: "Find your plugins",
                description:
                    "Search Modrinth, install plugins and mods, and keep them updated from the panel.",
                image: "/screens/gameserver-5.png",
                alt: "Plugins installed from Modrinth",
            },
            {
                title: "Greet every player",
                description:
                    "When someone joins, ask your agent for a welcome and say it in Minecraft chat. Build it in Actions.",
                image: "/screens/gameserver-flow.png",
                alt: "A player join asking the agent for a welcome, shortening it, and saying it in Minecraft chat",
            },
        ],
    },
    {
        slug: "bot-creator",
        summary: "Your own Discord bots, without code",
        name: "Bot Creator",
        seoTitle: "Discord bot builder and automation | Paperboard",
        icon: "/pictures/discord-bot.png",
        accent: "var(--paper-panel-botcreator)",
        headline: "Your own Discord bot",
        headlineLines: ["Your own", "Discord bot"],
        description:
            "Make slash commands, buttons, and polls without writing code, then decide what they do in Actions, from starting a server to asking your agent.",
        image: "/screens/botcreator-2.png",
        alt: "A bot's health and its latest messages",
        features: [
            {
                title: "Build it in Actions",
                description:
                    "Each bot has its own project in Actions. Post polls, share files, and schedule events with its blocks.",
                image: "/screens/botcreator-6.png",
                alt: "Polls, files and scheduled events as Actions blocks in a bot's project",
            },
            {
                title: "Run several bots",
                description: "Each bot gets its own token, commands, and project. Turn any of them off with one switch.",
                image: "/screens/botcreator-1.png",
                alt: "Several bots, each with its own token, commands and project",
            },
            {
                title: "Create commands",
                description:
                    "Build slash commands and buttons. Use Actions for the logic behind them.",
                image: "/screens/botcreator-5.png",
                alt: "Slash commands the bot registers with Discord",
            },
            {
                title: "Browse your servers",
                description:
                    "See channels, roles, and members, and send a message from the panel.",
                image: "/screens/botcreator-4.png",
                alt: "A server's channels and roles, finding members and sending a message",
            },
        ],
        note: "You'll need a Discord application and a bot token to connect. Visual workflows use the Actions panel.",
    },
    {
        slug: "actions",
        summary: "Visual automation and workflow builder",
        name: "Actions",
        seoTitle: "Visual workflow automation | Paperboard",
        icon: "/pictures/blocks.png",
        accent: "var(--paper-panel-actions)",
        headline: "Connect your panels",
        headlineLines: ["Connect", "your panels"],
        description:
            "Build workflows with triggers, action blocks, and results from your other panels.",
        image: "/screens/actions-1.png",
        alt: "A Discord bot's flows: a movie night poll and event, suggestions, dice and a welcome DM",
        features: [
            {
                title: "Keep projects apart",
                description:
                    "Give each job its own project with its own flows. Switch one off without touching the rest.",
                image: "/screens/actions-2.png",
                alt: "Projects, each with its own flows and on/off switch",
            },
            {
                title: "Use any panel's blocks",
                description:
                    "The Library holds the blocks every panel adds. Pick a bot and drag its Discord actions into a flow.",
                image: "/screens/actions-3.png",
                alt: "The Library, switching between Bot Creator's bots for their blocks",
            },
            {
                title: "Try ideas safely",
                description: "Make a copy of a project to try a change without touching the original.",
                image: "/screens/actions-4.png",
                alt: "The Project menu, apart from File, Backup and Insert",
            },
        ],
    },
];

// Learn pages that moved, kept as redirects so old links still land.
export const MOVED_LEARN_PAGES: { path: string; target: string }[] = [{ path: "/ai/", target: "/agents/" }];

/** The longest headline line of any panel: their headlines share one size. */
export const HEADLINE_FIT_LENGTH = Math.max(...LEARN_PANELS.flatMap((panel) => panel.headlineLines.map((line) => line.length)));
