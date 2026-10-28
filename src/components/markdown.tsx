// Renders study content: Markdown with LaTeX math (KaTeX). Raw HTML is never rendered.
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";

/** Models often write \( \) and \[ \] for math; convert them to $ and $$ so they render. */
function normalizeMath(src: string) {
  return src
    .replace(/\\\[([\s\S]*?)\\\]/g, (_, m) => `\n$$\n${m.trim()}\n$$\n`)
    .replace(/\\\(([\s\S]*?)\\\)/g, (_, m) => `$${m.trim()}$`);
}

export function Markdown({ children, className }: { children: string; className?: string }) {
  return (
    <div className={className ?? "prose-yx"}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[[rehypeKatex, { throwOnError: false, strict: "ignore" }]]}
        components={{
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noopener noreferrer">
              {children}
            </a>
          ),
        }}
      >
        {normalizeMath(children ?? "")}
      </ReactMarkdown>
    </div>
  );
}
