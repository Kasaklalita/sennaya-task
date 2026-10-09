import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCorners,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { ALL_STATUSES, INITIAL_STATUS, isLaptopStatus } from '@domain';
import {
  LayoutGridIcon,
  Loader2Icon,
  ScrollTextIcon,
  SendIcon,
  TriangleAlertIcon,
} from 'lucide-react';
import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { toast } from 'sonner';

import { ClockControl } from '@/components/ClockControl';
import { EventLog } from '@/components/EventLog';
import { HistoryDialog } from '@/components/HistoryDialog';
import { LaptopCardBody } from '@/components/LaptopCard';
import { StatusColumn } from '@/components/StatusColumn';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { humanizeDates } from '@/lib/format';
import { evaluateTargets, useBoard } from '@/lib/board';

export function StatusBoard() {
  const onSuccess = useCallback((message: string) => {
    toast.success(message, { description: 'Записано в базу' });
  }, []);

  const onFailure = useCallback((code: string, message: string) => {
    toast.error(code, { description: humanizeDates(message) });
  }, []);

  const board = useBoard(useMemo(() => ({ onSuccess, onFailure }), [onSuccess, onFailure]));

  const [activeId, setActiveId] = useState<string | null>(null);
  const [historyId, setHistoryId] = useState<string | null>(null);

  const sensors = useSensors(
    // Небольшой порог, чтобы клик по кнопке «история» не считался началом перетаскивания.
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    // Клавиатура: Tab до карточки, Пробел — взять, стрелки — выбрать колонку, Пробел — отпустить.
    useSensor(KeyboardSensor),
  );

  const activeItem = board.laptops.find((item) => item.laptop.id === activeId) ?? null;
  const historyItem = board.laptops.find((item) => item.laptop.id === historyId) ?? null;

  /**
   * Карточку тащат — спросить домен сразу про все колонки.
   *
   * Это подсказка, не решение. Домен крутиться прямо в браузере: ответ
   * мгновенный, сеть не нужна. Настоящую проверку делать сервер тем же кодом.
   */
  const verdicts = useMemo(
    () => (activeItem === null ? null : evaluateTargets(activeItem.laptop, board.now)),
    [activeItem, board.now],
  );

  const resolveModel = useCallback(
    (laptopId: string) =>
      board.laptops.find((item) => item.laptop.id === laptopId)?.model ?? laptopId,
    [board.laptops],
  );

  function handleDragEnd(event: DragEndEvent) {
    setActiveId(null);

    const { active, over } = event;
    if (over === null) {
      return;
    }

    // id колонки — это статус. Проверить тем же guard'ом, что и домен:
    // на границе с библиотекой таскания это снова `unknown`.
    const target = String(over.id);
    if (!isLaptopStatus(target)) {
      return;
    }

    const laptopId = String(active.id);
    const item = board.laptops.find((entry) => entry.laptop.id === laptopId);

    // Отпустили там же, где взяли — это не попытка, а отмена.
    if (item === undefined || item.laptop.status === target) {
      return;
    }

    void board.move(laptopId, target);
  }

  /**
   * Тело страницы.
   *
   * В переменной, не в раннем `return`: шапка с заголовком и вкладками должна
   * стоять на месте и пока грузится, и при ошибке.
   */
  let body: ReactNode;

  if (board.loading) {
    body = (
      <div className="flex min-h-64 items-center justify-center gap-2 text-sm text-muted-foreground">
        <Loader2Icon className="size-4 animate-spin" aria-hidden />
        Загружаю доску из базы…
      </div>
    );
  } else if (board.loadError !== null) {
    body = (
      <div className="flex min-h-64 flex-col items-center justify-center gap-3 rounded-xl border border-rose-500/30 bg-rose-500/5 p-8 text-center">
        <TriangleAlertIcon className="size-6 text-rose-400" aria-hidden />
        <div>
          <p className="text-sm font-medium">Не удалось загрузить доску</p>
          <p className="mt-1 text-xs text-muted-foreground">{board.loadError}</p>
          <p className="mt-2 text-xs text-muted-foreground">
            Запущен ли API? <code className="font-mono">npm run dev</code> поднимает его
            вместе с фронтендом.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void board.reload()}>
          Повторить
        </Button>
      </div>
    );
  } else {
    body = (
      <div className="flex flex-col gap-4">
        <ClockControl
          now={board.now}
          clockShifted={board.clockShifted}
          onShift={board.shiftClock}
          onSet={board.setClock}
          onResetClock={board.resetClock}
          onResetBoard={() => void board.reset()}
        />

        <TabsContent value="board" className="m-0">
          <DndContext
            sensors={sensors}
            collisionDetection={closestCorners}
            onDragStart={(event: DragStartEvent) => setActiveId(String(event.active.id))}
            onDragEnd={handleDragEnd}
            onDragCancel={() => setActiveId(null)}
            accessibility={{
              screenReaderInstructions: {
                draggable:
                  'Нажмите пробел, чтобы взять карточку ноутбука. Стрелками выберите колонку статуса, пробелом отпустите, Escape отменит перетаскивание.',
              },
            }}
          >
            {/* Колонки расти из ALL_STATUSES: добавить статус в домен — появиться колонка. */}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {ALL_STATUSES.map((status) => (
                <StatusColumn
                  key={status}
                  status={status}
                  laptops={board.laptops.filter((item) => item.laptop.status === status)}
                  now={board.now}
                  verdict={verdicts?.find((verdict) => verdict.to === status) ?? null}
                  isSource={activeItem?.laptop.status === status}
                  onOpenHistory={setHistoryId}
                  // Куда приезжать новому ноутбуку — знать домен, не вёрстка.
                  onAdd={status === INITIAL_STATUS ? () => void board.add() : undefined}
                />
              ))}
            </div>

            <DragOverlay>
              {activeItem !== null && (
                <LaptopCardBody item={activeItem} now={board.now} floating />
              )}
            </DragOverlay>
          </DndContext>
        </TabsContent>

        <TabsContent value="log" className="m-0">
          <EventLog entries={board.attempts} resolveModel={resolveModel} />
        </TabsContent>
      </div>
    );
  }

  return (
    // Корень Tabs обнимать и шапку, и панели: переключатель жить в шапке,
    // панели ниже, а состояние у них одно.
    <Tabs defaultValue="board">
      <header className="mb-6 flex flex-wrap items-center gap-x-4 gap-y-3">
        <h1 className="text-2xl font-semibold tracking-tight">Статусы ноутбука на складе</h1>

        {/* rel обязателен: без него открытая вкладка получать доступ
            к этой через window.opener. */}
        <a
          href="https://t.me/PolienkoVeniamin"
          target="_blank"
          rel="noreferrer noopener"
          className="flex items-center gap-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground hover:underline"
        >
          <SendIcon className="size-3" aria-hidden />
          Вениамин Полиенко
        </a>

        <TabsList className="ml-auto">
          <TabsTrigger value="board">
            <LayoutGridIcon className="size-3.5" aria-hidden />
            Доска
          </TabsTrigger>
          <TabsTrigger value="log">
            <ScrollTextIcon className="size-3.5" aria-hidden />
            Журнал попыток
            {board.attempts.length > 0 && (
              <span className="ml-1 rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                {board.attempts.length}
              </span>
            )}
          </TabsTrigger>
        </TabsList>
      </header>

      {body}

      <HistoryDialog item={historyItem} onClose={() => setHistoryId(null)} />
    </Tabs>
  );
}
