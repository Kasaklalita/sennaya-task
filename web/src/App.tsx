import { StatusBoard } from '@/components/StatusBoard';
import { Toaster } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';

/**
 * Обёртка страницы: контейнер и тосты.
 *
 * Заголовок и вкладки уехали в `StatusBoard`: переключатель обязан сидеть под
 * тем же корнем `Tabs`, что и панели, и ему нужен счётчик журнала — а эти
 * данные жить в состоянии доски.
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
