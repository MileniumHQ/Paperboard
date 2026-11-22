// The thread pdf.js parses documents on. PaperUI's build bundles it into a
// file of its own (see startWorker in pdfjs.ts), served from the page's own
// origin, so it loads under a panel's `worker-src 'self'`.
import "pdfjs-dist/build/pdf.worker.min.mjs";
