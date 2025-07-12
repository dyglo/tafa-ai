import React, { memo } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { CodeBlock } from './code-block'; // Make sure this path is correct

const components: Partial<Components> = {
  // This is the only custom renderer we need for code.
  // It handles both inline and block code.
  code({ node, inline, className, children, ...props }: any) {
    const match = /language-(\w+)/.exec(className || '');
    const codeString = String(children).replace(/\n$/, '');
    
    if (!inline && match) {
      // This handles fenced code blocks (```)
      return (
        <CodeBlock
          language={match[1]}
          value={codeString}
        />
      );
    } else {
      // This handles inline code (`)
      return (
        <code className="bg-zinc-800 text-red-400 px-1.5 py-1 rounded-md" {...props}>
          {children}
        </code>
      );
    }
  }
};

const NonMemoizedMarkdown = ({ children }: { children: string }) => {
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
      {children}
    </ReactMarkdown>
  );
};

export const Markdown = memo(
  NonMemoizedMarkdown,
  (prevProps, nextProps) => prevProps.children === nextProps.children,
);