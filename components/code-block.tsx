'use client'

import React, { useState } from 'react'
// @ts-ignore – optional dependency with no TS types shipped
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
// @ts-ignore – optional dependency with no TS types shipped
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism'

interface CodeBlockProps {
  // Props provided by react-markdown for the `code` element
  node?: any
  inline?: boolean
  className?: string
  children?: React.ReactNode
  // Props when used directly with explicit language/value
  language?: string
  value?: string
  [key: string]: any
}

export const CodeBlock: React.FC<CodeBlockProps> = ({
  inline: inlineProp,
  className = '',
  children,
  language: languageProp,
  value,
  ...props
}) => {
  const [isCopied, setIsCopied] = useState(false)

  // Determine language from className (e.g., language-js)
  const match = /language-(\w+)/.exec(className || '')
  const language = languageProp ?? (match ? match[1] : '')

  // Normalise children (react-markdown passes the code string here)
  const code = (value ?? String(children)).replace(/\n$/, '')

  // Render INLINE code – simple <code> tag
  const inline = inlineProp ?? false

  if (inline) {
    return (
      <code
        className={`${className} text-sm bg-zinc-100 dark:bg-zinc-800 py-0.5 px-1 rounded-md`}
        {...props}
      >
        {children}
      </code>
    )
  }

  // Handler for the Copy button
  const handleCopy = () => {
    navigator.clipboard.writeText(code)
    setIsCopied(true)
    setTimeout(() => setIsCopied(false), 2000)
  }

  // Render BLOCK code with header + syntax highlighting
  return (
    <div className="relative my-4 not-prose rounded-md bg-zinc-900 border border-zinc-700 max-h-[500px] overflow-y-auto">
      <div className="flex items-center justify-between px-4 py-1.5 border-b border-zinc-700">
        <span className="text-xs lowercase text-zinc-400">{language || 'code'}</span>
        <button
          type="button"
          onClick={handleCopy}
          className="text-xs font-sans text-zinc-400 hover:text-white transition-colors"
        >
          {isCopied ? 'Copied!' : 'Copy'}
        </button>
      </div>

      <SyntaxHighlighter
        language={language}
        style={oneDark}
        PreTag="div"
        customStyle={{
          margin: 0,
          padding: '1rem',
          backgroundColor: 'transparent',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-all',
        }}
        codeTagProps={{
          style: {
            fontFamily: 'inherit',
            fontSize: '0.875rem',
          },
        }}
        {...props}
      >
        {code}
      </SyntaxHighlighter>
    </div>
  )
}