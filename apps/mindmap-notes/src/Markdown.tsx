import ReactMarkdown, { defaultUrlTransform } from "react-markdown";
import { safeEmbeddedImage } from "./pasteImage";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import { openExternal } from "./adapters";
export default function Markdown({
  text,
  compact = false,
}: {
  text: string;
  compact?: boolean;
}) {
  return (
    <div className={`markdown ${compact ? "compact" : ""}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[
          [rehypeKatex, { throwOnError: false, strict: false, trust: false }],
        ]}
        urlTransform={(url) =>
          safeEmbeddedImage(url) ? url : defaultUrlTransform(url)
        }
        skipHtml
        components={{
          a: ({ href, children }) => (
            <a
              href={href}
              onClick={(e) => {
                e.preventDefault();
                if (href) void openExternal(href).catch(() => {});
              }}
            >
              {children}
            </a>
          ),
          img: ({ alt, src }) =>
            src && safeEmbeddedImage(src) ? (
              <img
                src={src}
                alt={alt || "图片"}
                loading="lazy"
                draggable={false}
              />
            ) : (
              <span className="image-placeholder">
                [图片：{alt || "外部图片"}]
              </span>
            ),
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}
