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
import { Loader2Icon, TriangleAlertIcon } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';
import { toast } from 'sonner';

import { ClockControl } from '@/components/ClockControl';
import { EventLog } from '@/components/EventLog';
import { HistoryDialog } from '@/components/HistoryDialog';
import { LaptopCardBody } from '@/components/LaptopCard';
import { StatusColumn } from '@/components/StatusColumn';
import { Button } from '@/components/ui/button';
import { evaluateTargets, useBoard } from '@/lib/board';

export function StatusBoard() {
  const onSuccess = useCallback((message: string) => {
    toast.success(message, { description: 'Записано в базу' });
  }, []);

  const onFailure = useCallback((code: string, message: string) => {
    toast.error(code, { description: message });
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
   * Пока карточку тащат — спрашиваем домен сразу про все колонки.
   *
   * Это подсказка, а не решение: домен выполняется прямо в браузере, поэтому
   * ответ мгновенный и без обращения к сети. Авторитетную проверку делает
   * сервер тем же кодом при отпускании.
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

    // id колонки — это статус. Проверяем его тем же guard'ом, что и домен:
    // на границе между библиотекой перетаскивания и доменом это снова `unknown`.
    const target = String(over.id);
    if (!isLaptopStatus(target)) {
      return;
    }

    const laptopId = String(active.id);
    const item = board.laptops.find((entry) => entry.laptop.id === laptopId);

    // Отпустили там же, откуда взяли — это не попытка перехода, а отмена.
    if (item === undefined || item.laptop.status === target) {
      return;
    }

    void board.move(laptopId, target);
  }

  if (board.loading) {
    return (
      <div className="flex min-h-64 items-center justify-center gap-2 text-sm text-muted-foreground">
        <Loader2Icon className="size-4 animate-spin" aria-hidden />
        Загружаю доску из базы…
      </div>
    );
  }

  if (board.loadError !== null) {
    return (
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
  }

  return (
    <div className="flex flex-col gap-4">
      <ClockControl
        now={board.now}
        clockShifted={board.clockShifted}
        onShift={board.shiftClock}
        onSet={board.setClock}
        onResetClock={board.resetClock}
        onResetBoard={() => void board.reset()}
      />

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
        {/* Колонки порождаются из ALL_STATUSES: добавится статус в домене — появится колонка. */}
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
              // Куда приезжает новый ноутбук — знает домен, не вёрстка.
              onAdd={status === INITIAL_STATUS ? () => void board.add() : undefined}
            />
          ))}
        </div>

        <DragOverlay>
          {activeItem !== null && <LaptopCardBody item={activeItem} now={board.now} floating />}
        </DragOverlay>
      </DndContext>

      <EventLog entries={board.attempts} resolveModel={resolveModel} />

      <HistoryDialog item={historyItem} onClose={() => setHistoryId(null)} />
    </div>
  );
}
