// The shell suite's pages: a list whose rows open pages of their own, named
// to the shell the way PaperUI's PaperSlidePage names its pages (its
// "paperui:page-crumbs" event), and closed by the shell's Back the way
// PaperSlidePage closes them ("paperboard:back").
import "@mileniumhq/paperapi";

const open: string[] = [];
const app = document.getElementById("app")!;
app.innerHTML = `<button type="button" id="server">My Server</button><p id="shown"></p>`;
const shown = document.getElementById("shown")!;

function render() {
    shown.textContent = open.join(" › ") || "The list";
    window.dispatchEvent(new CustomEvent("paperui:page-crumbs", { detail: { titles: [...open] } }));
}

document.getElementById("server")!.addEventListener("click", () => {
    open.push("My Server", "Overview");
    render();
});
window.addEventListener("paperboard:back", (event) => {
    if (!open.length) return;
    event.preventDefault();
    open.pop();
    render();
});
render();
