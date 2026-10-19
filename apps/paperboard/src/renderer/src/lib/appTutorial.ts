// Paperboard's own tutorial, shown the first time the app opens. Its
// pictures are bundled with the shell, so they load before any computer does.

import type { TutorialStep } from "@mileniumhq/paperapi";
import homeLight from "../assets/tutorial/1-light.webp";
import homeDark from "../assets/tutorial/1-dark.webp";
import editLight from "../assets/tutorial/2-light.webp";
import editDark from "../assets/tutorial/2-dark.webp";
import panelsLight from "../assets/tutorial/3-light.webp";
import panelsDark from "../assets/tutorial/3-dark.webp";
import libraryLight from "../assets/tutorial/4-light.webp";
import libraryDark from "../assets/tutorial/4-dark.webp";
import computerLight from "../assets/tutorial/5-light.webp";
import computerDark from "../assets/tutorial/5-dark.webp";

export const APP_TUTORIAL: TutorialStep[] = [
    {
        title: "Welcome to Paperboard",
        body: "One dashboard for the programs you host yourself. Every app here is a panel, and Home gathers their widgets.",
        image: { light: homeLight, dark: homeDark, alt: "Home with widgets from several panels" },
    },
    {
        title: "Make Home yours",
        body: "Press Edit Home, pick a widget's size, then drag it onto the grid. Each panel brings its own widgets.",
        image: { light: editLight, dark: editDark, alt: "Home being edited with the widget library open" },
    },
    {
        title: "Panels keep running",
        body: "Panels live on a computer. Their services keep running there even after you close Paperboard.",
        image: { light: panelsLight, dark: panelsDark, alt: "A computer's panels listed in the sidebar" },
    },
    {
        title: "Find more panels",
        body: "Open the Panel Library to install more.",
        image: { light: libraryLight, dark: libraryDark, alt: "The Panel Library" },
    },
    {
        title: "Bring your other computers",
        body: "Press Add Computer in the rail to pair another machine. Its panels show up right next to these.",
        image: { light: computerLight, dark: computerDark, alt: "The Connect a Computer dialog" },
    },
];
