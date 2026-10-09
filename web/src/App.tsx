import { RETURN_WINDOW_DAYS } from '@domain';
import { WorkflowIcon } from 'lucide-react';

import { StatusBoard } from '@/components/StatusBoard';
import { Badge } from '@/components/ui/badge';
import { Toaster } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';

export default function App() {
  return (
    <TooltipProvider>
      <div className="min-h-screen bg-background">
        <div className="mx-auto max-w-[96rem] px-4 py-6 sm:px-6 lg:py-10">
          <header className="mb-6">
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-2xl font-semibold tracking-tight">
                Статусы ноутбука на складе
              </h1>
              <Badge variant="outline" className="font-mono text-[11px]">
                окно возврата: {RETURN_WINDOW_DAYS} дней
              </Badge>
            </div>
          </header>

          <StatusBoard />

          <footer className="mt-8 flex items-center gap-2 text-[11px] text-muted-foreground">
            <WorkflowIcon className="size-3.5" aria-hidden />
            React + shadcn/ui + dnd-kit · API на node:http · хранение в node:sqlite.
            Ноль рантайм-зависимостей, 164 теста.
          </footer>
        </div>

        <Toaster position="bottom-right" richColors closeButton />
      </div>
    </TooltipProvider>
  );
}
