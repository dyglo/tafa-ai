import { useState } from 'react';
import { Sheet, SheetContent, SheetTrigger, SheetTitle } from './ui/sheet';
import { Button } from './ui/button';
import { cn } from '@/lib/utils';

export interface Source {
  title: string;
  link: string;
  snippet: string;
}

export function SourcePills({
  sources,
  className,
}: {
  sources: Source[];
  className?: string;
}) {
  const [open, setOpen] = useState(false);

  const uniqueSources = sources.reduce<Source[]>((acc, src) => {
    if (!acc.find((s) => s.link === src.link)) acc.push(src);
    return acc;
  }, []);

  return (
    <div className={cn('flex flex-wrap gap-2', className)}>
      {uniqueSources.map((source, idx) => {
        const domain = (() => {
          try {
            return new URL(source.link).hostname.replace('www.', '');
          } catch (_) {
            return source.link;
          }
        })();

        return (
          <a
            key={source.link}
            href={source.link}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs px-2 py-1 border rounded-full hover:bg-accent hover:text-accent-foreground"
          >
            {domain}
          </a>
        );
      })}

      {/* View all sources button triggers sheet */}
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger asChild>
          <Button variant="ghost" size="sm" className="text-xs px-2 py-1">
            View Sources
          </Button>
        </SheetTrigger>
        <SheetContent side="right" className="w-96 p-6 overflow-y-auto">
          {/* Visually hidden title for accessibility compliance */}
          <SheetTitle className="sr-only">Sources</SheetTitle>

          <h2 className="text-lg font-semibold mb-4">Sources</h2>
          <ul className="space-y-4">
            {uniqueSources.map((source) => (
              <li key={source.link} className="flex flex-col gap-1">
                <a
                  href={source.link}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-medium text-primary hover:underline"
                >
                  {source.title}
                </a>
                <span className="text-xs text-muted-foreground break-all">
                  {source.link}
                </span>
                <p className="text-sm text-muted-foreground">
                  {source.snippet}
                </p>
              </li>
            ))}
          </ul>
        </SheetContent>
      </Sheet>
    </div>
  );
} 