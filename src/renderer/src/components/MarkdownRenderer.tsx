import { memo } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'
import 'highlight.js/styles/github-dark.css'
// Overrides the palette above under the light app theme (see main.css `--app-*`)
import '@/assets/hljs-github-light.css'

// Ref https://github.com/tailwindlabs/tailwindcss-typography to fine-tune the markdown style
function MarkdownRenderer({ children }: { children: string }) {
  return (
    <div className="prose prose-sm prose-invert max-w-none prose-pre:p-0 prose-code:text-xs">
      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>
        {children}
      </ReactMarkdown>
    </div>
  )
}

// Parsing and highlighting the whole answer is the expensive part, so only a
// change to the text itself re-renders it
export default memo(MarkdownRenderer)
