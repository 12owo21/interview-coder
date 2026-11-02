// Vite's `?raw` import: the file's text, inlined at build time (see mobile-sync.ts)
declare module '*?raw' {
  const content: string
  export default content
}
