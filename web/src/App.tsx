import { WorkflowIcon } from 'lucide-react';

import { StatusBoard } from '@/components/StatusBoard';
import { Toaster } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';

/**
 * Оболочка страницы: контейнер, тосты, подвал.
 *
 * Заголовок и переключатель вкладок переехали внутрь `StatusBoard`: переключатель
 * обязан находиться под тем же корнем `Tabs`, что и панели, и ему нужен счётчик
 * записей журнала — а эти данные живут в состоянии доски.
 */
export default function App() {
  return (
    <TooltipProvider>
      <div className="min-h-screen bg-background">
        <div className="mx-auto max-w-[96rem] px-4 py-6 sm:px-6 lg:py-10">
          <StatusBoard />

          <footer className="mt-8 flex items-center gap-2 text-[11px] text-muted-foreground">
            <WorkflowIcon className="size-3.5" aria-hidden />
            React + shadcn/ui + dnd-kit · API на node:http · хранение в node:sqlite.
            Ноль рантайм-зависимостей, 171 тест.
          </footer>
        </div>

        <Toaster position="bottom-right" richColors closeButton />
      </div>
    </TooltipProvider>
  );
}
