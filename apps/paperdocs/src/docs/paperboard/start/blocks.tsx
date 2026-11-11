import {
    PaperCode,
    PaperFlex,
    PaperLink,
    PaperText,
    PaperTextList,
} from "@mileniumhq/paperui";

export default function BlocksDoc() {
    return (
        <PaperFlex direction="column" gap="double" fullWidth>
            <PaperText preset="header" as="h1">Automate with Blocks</PaperText>
            <PaperText preset="body" as="p">
                Blocks builds automations by snapping blocks together.
                A flow starts on an event, such as a player joining your server or the agent texting you, and runs the steps under it.
                Every panel you install adds its own blocks, so one flow can reach across your panels.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="before-you-start">Before you start</PaperText>
            <PaperText preset="body" as="p">
                Install Blocks from the Panel Library on the computer the flows should run on, and install the panels the flows use on that computer too.
                See <PaperLink href="/docs/paperboard/panels/">Install and manage panels</PaperLink>.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="projects">Projects</PaperText>
            <PaperText preset="body" as="p">
                Blocks opens on your projects. A project is one canvas of flows.
                Select <b>New project</b> to start one, or select a project to open it.
                A project's <b>⋮</b> menu has <b>Open</b>, <b>Rename</b>, <b>Make a copy</b> and <b>Delete</b>.
            </PaperText>
            <PaperText preset="body" as="p">
                The switch on each project turns its flows on and off.
                When it is off, the project's flows don't start on their events. <b>Run</b> still works.
                Blocks saves your changes as you make them.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="build-a-flow">Build a flow</PaperText>
            <PaperTextList ordered>
                <li>Open a project. The Library is on the left, and the canvas is on the right.</li>
                <li>Pick a section in the Library's rail, or type in the search box above the blocks to search every section.</li>
                <li>Drag a block that starts a flow onto the canvas, such as <b>When Run is clicked</b> in <b>Flow</b>.</li>
                <li>Drag steps into its gap. Each step snaps under the one before it.</li>
                <li>Drop values into the rounded and pointed holes in a block. A rounded hole takes a value, and a pointed one takes true or false.</li>
            </PaperTextList>
            <PaperText preset="body" as="p">
                A hole for a thing a panel has, such as a server, a bot or a conversation, starts as a menu of the ones there are. Pick one, or drop a block over the menu, such as a variable, to use a value from the flow instead. Every other menu in a hole works the same way.
            </PaperText>
            <PaperText preset="body" as="p">
                A step that gives something back, such as <b>Send Message</b>, has a gear. Select it to see what the step gave back, such as the message and its ID, and drag those blocks into later steps.
                Each one reads what its own step gave the last time it ran.
            </PaperText>
            <PaperText preset="body" as="p">
                To delete a block, drag it onto the trash in the corner of the canvas.
                The buttons above the trash zoom in, zoom out and reset the view.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="library">What the Library has</PaperText>
            <PaperText preset="body" as="p">
                The first sections are Blocks' own: <b>Flow</b> (waits, conditions, loops and <b>Try</b>), <b>Logic</b>, <b>Math</b>, <b>Text</b>, <b>Lists</b>, <b>Time</b>, <b>Web</b>, <b>Variables</b> and <b>Functions</b>.
                Under them, each installed panel has a section with its icon. Its blocks show the same icon and share a colour.
                A panel with projects of its own, such as Game Server's servers, has a menu at the top of its section to pick which one the blocks use. Each project shows the picture its panel shows, such as a server's icon.
            </PaperText>
            <PaperText preset="body" as="p">
                A block whose panel is not running stays on the canvas with a warning, and works again when the panel is back.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="run">Run and stop flows</PaperText>
            <PaperText preset="body" as="p">
                Select <b>Run</b> (▶) at the top right to run the flows that start with <b>When Run is clicked</b>.
                Flows that start on an event run on their own whenever it happens.
                While flows are running, <b>Stop</b> stops them.
            </PaperText>
            <PaperText preset="body" as="p">
                The <b>Console</b> under the canvas shows what <b>Log</b> blocks write, and every error.
                A block that fails also gets a warning on the canvas that says what went wrong.
                To handle a failure inside a flow, put the steps in a <b>Try</b> block: the steps under <b>If it fails</b> run instead of the flow stopping, and <b>error message</b> holds the reason.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="variables">Variables</PaperText>
            <PaperText preset="body" as="p">
                In <b>Variables</b>, select <b>Create variable</b> and name it.
                The section then has blocks to set the variable, change it by a number, and read it.
                Each run starts with its variables empty. Reading a variable that has no value yet is an error.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="functions">Functions</PaperText>
            <PaperText preset="body" as="p">
                A function is a set of steps you make once and use from any flow in the project.
            </PaperText>
            <PaperTextList ordered>
                <li>In <b>Functions</b>, drag <b>to do something</b> onto the canvas and type its name over <b>do something</b>.</li>
                <li>Put its steps inside it. Select the gear on the block to give it inputs.</li>
                <li>A block that calls it now appears in <b>Functions</b>. Drag it into a flow.</li>
            </PaperTextList>
            <PaperText preset="body" as="p">
                The second block, the one with <b>return</b>, makes a function that gives back a value. Its call block goes into a hole like any other value.
                The <b>if</b> block with <b>return</b> in it ends a function early when its condition is true.
                A function that calls itself more than 1000 times deep fails with <PaperCode>Functions called each other 1000 deep, so the run stopped</PaperCode>.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="files-and-backups">Files and backups</PaperText>
            <PaperText preset="body" as="p">
                The menus under the project's name hold the rest:
            </PaperText>
            <PaperTextList>
                <li><b>Project</b>: <b>New project</b>, <b>Make a copy</b>, <b>Rename</b> and <b>Delete</b>.</li>
                <li><b>File</b>: <b>Export</b> saves the project's flows to a file. <b>Import</b> adds a file's flows to this canvas, next to the ones already on it.</li>
                <li><b>Backup</b>: <b>Create backup</b> backs up every project. The first time, Blocks asks where backups go. <b>Load backup</b> replaces every project with a backup's, and stops the flows running now.</li>
            </PaperTextList>

            <PaperText preset="body" as="p">
                Next: <PaperLink href="/docs/paperboard/server-daemon/">run panels on another computer</PaperLink>.
            </PaperText>
        </PaperFlex>
    );
}
