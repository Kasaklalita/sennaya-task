import { useDroppable } from '@dnd-kit/core';
import {
  STATUS_LABELS,
  allowedTransitionsFrom,
  isTerminalStatus,
  type LaptopStatus,
} from '@domain';
import { CheckIcon, CornerDownRightIcon, XIcon } from 'lucide-react';

import { DraggableLaptopCard } from '@/components/LaptopCard';
import { Badge } from '@/components/ui/badge';
import { STATUS_ACCENT } from '@/lib/statusStyles';
import type { BoardLaptop } from '@/lib/api';
import type { TargetVerdict } from '@/lib/board';
import { cn } from '@/lib/utils';

interface StatusColumnProps {
  readonly status: LaptopStatus;
  readonly laptops: readonly BoardLaptop[];
  readonly now: Date;
  /** Вердикт домена для перетаскиваемой карточки. `null` — ничего не тащат. */
  readonly verdict: TargetVerdict | null;
  /** Это колонка, из которой карточку взяли. */
  readonly isSource: boolean;
  readonly onOpenHistory: (laptopId: string) => void;
}

export function StatusColumn({
  status,
  laptops,
  now,
  verdict,
  isSource,
  onOpenHistory,
}: StatusColumnProps) {
  const { setNodeRef, isOver } = useDroppable({ id: status });

  const accent = STATUS_ACCENT[status];
  const outgoing = allowedTransitionsFrom(status);
  const terminal = isTerminalStatus(status);

  const dragging = verdict !== null;
  const allowed = verdict?.allowed === true;
  const rejected = dragging && !allowed && !isSource;

  return (
    <section
      ref={setNodeRef}
      aria-label={`Колонка «${STATUS_LABELS[status]}»`}
      className={cn(
        'flex min-h-[26rem] flex-col rounded-xl border bg-muted/20 transition-all',
        accent.column,
        allowed && 'border-emerald-500/60 bg-emerald-500/5 ring-1 ring-emerald-500/30',
        rejected && 'border-rose-500/40 bg-rose-500/5 opacity-80',
        allowed && isOver && 'ring-2 ring-emerald-400 ring-offset-2 ring-offset-background',
        rejected && isOver && 'border-rose-500/70 ring-2 ring-rose-400',
      )}
    >
      <header className="border-b px-3 py-2.5">
        <div className="flex items-center gap-2">
          <span className={cn('size-2 shrink-0 rounded-full', accent.dot)} aria-hidden />
          <h2 className="flex-1 text-sm font-semibold">{STATUS_LABELS[status]}</h2>
          <Badge variant="secondary" className="h-5 px-1.5 font-mono text-[11px]">
            {laptops.length}
          </Badge>
        </div>

        {/* Исходящие рёбра берутся из графа домена — интерфейс их не перечисляет руками. */}
        <p className="mt-1.5 flex items-start gap-1 text-[11px] leading-snug text-muted-foreground">
          <CornerDownRightIcon className="mt-px size-3 shrink-0" aria-hidden />
          <span>
            {terminal
              ? 'конечный статус — переходов нет'
              : outgoing.map((target) => STATUS_LABELS[target]).join(', ')}
          </span>
        </p>
      </header>

      {/* Пока карточку тащат, каждая колонка показывает ответ домена именно по ней. */}
      {dragging && (
        <div
          className={cn(
            'mx-2 mt-2 rounded-md border px-2.5 py-2 text-[11px] leading-snug',
            isSource && 'border-dashed text-muted-foreground',
            allowed && 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200',
            rejected && 'border-rose-500/40 bg-rose-500/10 text-rose-200',
          )}
          role="status"
        >
          {isSource ? (
            // Домен и на «ту же колонку» отвечает осмысленно — показываем его ответ,
            // а не придуманную интерфейсом заглушку.
            <>
              <span className="flex items-center gap-1.5 font-medium">
                <code className="font-mono text-[10px]">{verdict?.error?.code}</code>
              </span>
              <p className="mt-1">{verdict?.error?.message}</p>
            </>
          ) : allowed ? (
            <span className="flex items-center gap-1.5 font-medium">
              <CheckIcon className="size-3.5 shrink-0" aria-hidden />
              можно отпустить
            </span>
          ) : (
            <>
              <span className="flex items-center gap-1.5 font-medium">
                <XIcon className="size-3.5 shrink-0" aria-hidden />
                <code className="font-mono text-[10px]">{verdict?.error?.code}</code>
              </span>
              <p className="mt-1 text-rose-200/80">{verdict?.error?.message}</p>
            </>
          )}
        </div>
      )}

      <div className="flex flex-1 flex-col gap-2 p-2">
        {laptops.map((item) => (
          <DraggableLaptopCard
            key={item.laptop.id}
            item={item}
            now={now}
            onOpenHistory={onOpenHistory}
          />
        ))}

        {laptops.length === 0 && !dragging && (
          <p className="flex flex-1 items-center justify-center text-[11px] text-muted-foreground/60">
            пусто
          </p>
        )}
      </div>
    </section>
  );
}
