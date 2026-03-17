import React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Components } from "react-markdown";

/** Copy button for code blocks */
function CodeCopyButton({ code }: { code: string }) {
  const [copied, setCopied] = React.useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <button
      onClick={handleCopy}
      className="absolute top-2 right-2 p-1.5 text-text-tertiary hover:text-text-secondary transition-colors rounded-md hover:bg-white/10 cursor-pointer opacity-0 group-hover:opacity-100"
      title="Copy code"
    >
      {copied ? (
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path d="M20 6L9 17l-5-5" />
        </svg>
      ) : (
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
        </svg>
      )}
    </button>
  );
}

const components: Components = {
  // Fenced code blocks
  pre({ children, ...props }) {
    // Extract the raw code text from the <code> child
    const codeChild = React.Children.toArray(children).find(
      (child) => React.isValidElement(child) && child.type === "code",
    ) as React.ReactElement | undefined;

    let codeString = "";
    if (codeChild && React.isValidElement(codeChild)) {
      const extractText = (node: React.ReactNode): string => {
        if (typeof node === "string") return node;
        if (Array.isArray(node)) return node.map(extractText).join("");
        if (React.isValidElement(node) && (node.props as any)?.children) {
          return extractText((node.props as any).children);
        }
        return "";
      };
      codeString = extractText((codeChild.props as any)?.children);
    }

    // Extract language from code className
    let language = "";
    if (codeChild && React.isValidElement(codeChild)) {
      const className = (codeChild.props as any)?.className || "";
      const match = className.match(/language-(\w+)/);
      if (match) language = match[1];
    }

    return (
      <div className="ocean-md-code-block group relative my-3">
        {language && (
          <div className="flex items-center justify-between px-4 py-1.5 bg-gray-800 text-gray-400 text-xs rounded-t-lg border-b border-gray-700">
            <span>{language}</span>
          </div>
        )}
        <CodeCopyButton code={codeString} />
        <pre
          className={`overflow-x-auto p-4 text-xs font-mono leading-relaxed bg-gray-900 text-gray-100 ${
            language ? "rounded-b-lg" : "rounded-lg"
          }`}
          {...props}
        >
          {children}
        </pre>
      </div>
    );
  },

  // Inline code
  code({ children, className, ...props }) {
    // If className contains "language-", it's a fenced code block's <code> (handled by pre above)
    const isInline = !className;
    if (isInline) {
      return (
        <code
          className="px-1.5 py-0.5 mx-0.5 rounded-md bg-surface-tertiary text-ocean-700 text-[0.85em] font-mono"
          {...props}
        >
          {children}
        </code>
      );
    }
    return (
      <code className={className} {...props}>
        {children}
      </code>
    );
  },

  // Paragraphs
  p({ children, ...props }) {
    return (
      <p className="my-2 leading-relaxed" {...props}>
        {children}
      </p>
    );
  },

  // Headings
  h1({ children, ...props }) {
    return (
      <h1 className="text-xl font-bold mt-5 mb-2 text-text-primary" {...props}>
        {children}
      </h1>
    );
  },
  h2({ children, ...props }) {
    return (
      <h2 className="text-lg font-bold mt-4 mb-2 text-text-primary" {...props}>
        {children}
      </h2>
    );
  },
  h3({ children, ...props }) {
    return (
      <h3
        className="text-base font-semibold mt-3 mb-1.5 text-text-primary"
        {...props}
      >
        {children}
      </h3>
    );
  },
  h4({ children, ...props }) {
    return (
      <h4
        className="text-sm font-semibold mt-3 mb-1 text-text-primary"
        {...props}
      >
        {children}
      </h4>
    );
  },

  // Lists
  ul({ children, ...props }) {
    return (
      <ul className="my-2 ml-5 list-disc space-y-1" {...props}>
        {children}
      </ul>
    );
  },
  ol({ children, ...props }) {
    return (
      <ol className="my-2 ml-5 list-decimal space-y-1" {...props}>
        {children}
      </ol>
    );
  },
  li({ children, ...props }) {
    return (
      <li className="leading-relaxed" {...props}>
        {children}
      </li>
    );
  },

  // Blockquote
  blockquote({ children, ...props }) {
    return (
      <blockquote
        className="my-3 pl-4 border-l-3 border-ocean-300 text-text-secondary italic"
        {...props}
      >
        {children}
      </blockquote>
    );
  },

  // Links
  a({ children, href, ...props }) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="text-ocean-600 hover:text-ocean-700 underline underline-offset-2"
        {...props}
      >
        {children}
      </a>
    );
  },

  // Table
  table({ children, ...props }) {
    return (
      <div className="my-3 overflow-x-auto rounded-lg border border-border">
        <table className="min-w-full text-sm" {...props}>
          {children}
        </table>
      </div>
    );
  },
  thead({ children, ...props }) {
    return (
      <thead className="bg-surface-tertiary" {...props}>
        {children}
      </thead>
    );
  },
  th({ children, ...props }) {
    return (
      <th
        className="px-3 py-2 text-left font-semibold text-text-primary border-b border-border"
        {...props}
      >
        {children}
      </th>
    );
  },
  td({ children, ...props }) {
    return (
      <td className="px-3 py-2 border-b border-border" {...props}>
        {children}
      </td>
    );
  },

  // Horizontal rule
  hr(props) {
    return <hr className="my-4 border-border" {...props} />;
  },

  // Strong & emphasis
  strong({ children, ...props }) {
    return (
      <strong className="font-semibold text-text-primary" {...props}>
        {children}
      </strong>
    );
  },
  em({ children, ...props }) {
    return (
      <em className="italic" {...props}>
        {children}
      </em>
    );
  },

  // Images
  img({ src, alt, ...props }) {
    return (
      <img
        src={src}
        alt={alt || ""}
        className="my-2 max-w-full rounded-lg"
        loading="lazy"
        {...props}
      />
    );
  },
};

type MarkdownRendererProps = {
  content: string;
};

export const MarkdownRenderer = React.memo(function MarkdownRenderer({
  content,
}: MarkdownRendererProps) {
  return (
    <div className="ocean-markdown text-sm text-text-primary leading-relaxed">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {content}
      </ReactMarkdown>
    </div>
  );
});
