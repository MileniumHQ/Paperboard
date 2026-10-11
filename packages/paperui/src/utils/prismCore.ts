import Prism from "prismjs";

// Prism's grammar files are plain scripts that extend a global `Prism`. The
// core is CommonJS, so a bundler may defer evaluating it to the importing
// module's body, after those scripts already ran ("Prism is not defined").
// As its own ES module this runs to completion before highlight.ts's next
// import, so every grammar finds the core.
(globalThis as { Prism?: typeof Prism }).Prism ??= Prism;

export default Prism;
