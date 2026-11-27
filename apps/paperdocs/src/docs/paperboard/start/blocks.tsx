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
                New project asks what to start with: an empty project, or a template that is ready to run, such as <b>Restart a game server every night</b>, <b>Log when a backup fails</b> or <b>Count runs with Data</b>.
                A template that needs another panel, such as Game Server, says so until that panel is installed and has a server.
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
                The first sections are Blocks' own: <b>Flow</b> (waits, conditions, loops and <b>Try</b>), <b>Logic</b>, <b>Math</b>, <b>Text</b>, <b>Lists</b>, <b>Data</b>, <b>Time</b> (with the schedules), <b>Web</b>, <b>Variables</b> and <b>Functions</b>.
                Under them, each installed panel has a section with its icon. Its blocks show the same icon and share a colour.
                A panel with projects of its own, such as Game Server's servers, has a menu at the top of its section to pick which one the blocks use. Each project shows the picture its panel shows, such as a server's icon.
            </PaperText>
            <PaperText preset="body" as="p">
                For tidy output, <b>Text</b> has <b>pad</b> (7 becomes 007) and <b>with … decimals</b> (1234.5 becomes 1,234.50), and <b>Flow</b> has <b>For each … at …</b>, which gives each item and its position.
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

            <PaperText preset="subheader" as="h2" id="schedules">Run on a schedule</PaperText>
            <PaperText preset="body" as="p">
                The first blocks in <b>Time</b> start a flow on a schedule instead of an event:
            </PaperText>
            <PaperTextList>
                <li><b>Every 5 minutes</b> runs again and again, that long apart. Pick seconds, minutes or hours; the shortest is 5 seconds.</li>
                <li><b>Every day at 00:00</b> runs once a day at that time.</li>
                <li><b>On weekdays at 00:00</b> runs on weekdays, weekends, or one day of the week.</li>
            </PaperTextList>
            <PaperText preset="body" as="p">
                Type a time as hours and minutes on a 24-hour clock, such as <PaperCode>04:00</PaperCode> or <PaperCode>23:30</PaperCode>. Times are on the clock of the computer the flows run on.
                The night the clocks go forward, a time they skip runs an hour later; the night they go back, a time that comes twice runs once.
            </PaperText>
            <PaperText preset="body" as="p">
                Schedules run while the project's switch is on, with Blocks open or closed. Under each one, a line says when it runs next.
                If a run is still going when the next one is due, that one is skipped, and the Console says so.
                A run missed while the computer was off or asleep runs once when Blocks is back, a minute after it starts, and the schedule goes on from there. It never runs once for every run it missed, and a restart never runs it twice.
                Switching a project off, or changing a schedule, starts the schedule again from then.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="data">Keep data between runs</PaperText>
            <PaperText preset="body" as="p">
                A variable starts empty each run. To keep a value for the next run, use <b>Data</b>: each project keeps its own values by key, through restarts, until a flow deletes them.
            </PaperText>
            <PaperTextList>
                <li><b>Save data</b> keeps a value under a key: text, a number, true or false, a list or an object.</li>
                <li><b>data … or …</b> reads the value under a key, or the second value when there is none.</li>
                <li><b>Change data … by …</b> adds to a number, starting from 0. Flows that count at the same time never lose a count.</li>
                <li><b>data … exists</b>, <b>Delete data</b> and <b>data keys</b> check, remove and list what is kept.</li>
            </PaperTextList>
            <PaperText preset="body" as="p">
                A project keeps up to 1000 keys and 512 KB of data. Data is in Blocks' backups, and loading a backup brings back its data.
                Deleting a project deletes its data; <b>Make a copy</b> starts with none.
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
                <li><b>Backup</b>: <b>Create backup</b> backs up every project and its data. The first time, Blocks asks where backups go. <b>Load backup</b> replaces every project and its data with a backup's, and stops the flows running now. Schedules don't run again for times they already ran.</li>
            </PaperTextList>

            <PaperText preset="body" as="p">
                Next: <PaperLink href="/docs/paperboard/server-daemon/">run panels on another computer</PaperLink>.
            </PaperText>
        </PaperFlex>
    );
}
