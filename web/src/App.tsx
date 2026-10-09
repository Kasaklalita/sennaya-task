import { StatusBoard } from '@/components/StatusBoard';
import { Toaster } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';

/**
 * Оболочка страницы: контейнер и тосты.
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
        </div>

        <Toaster position="bottom-right" richColors closeButton />
      </div>
    </TooltipProvider>
  );
}
