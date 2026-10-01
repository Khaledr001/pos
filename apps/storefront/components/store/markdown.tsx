import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/** Staff-written markdown (descriptions, pages). Raw HTML is not rendered. */
export function Markdown({ children }: { children: string }) {
  return (
    <div className="prose-store">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{children}</ReactMarkdown>
    </div>
  );
}
