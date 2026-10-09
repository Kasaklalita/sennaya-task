import { useDraggable } from '@dnd-kit/core';
import { MS_IN_DAY, STATUS_LABELS, availableTransitions, returnDeadline } from '@domain';
import { BanIcon, ClockIcon, GripVerticalIcon, HistoryIcon, LaptopIcon } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type { BoardLaptop } from '@/lib/api';
import { formatDateTime, formatDayCount } from '@/lib/format';
import { STATUS_ACCENT } from '@/lib/statusStyles';
import { cn } from '@/lib/utils';

interface LaptopCardBodyProps {
  readonly item: BoardLaptop;
  readonly now: Date;
  readonly onOpenHistory?: (laptopId: string) => void;
  /** Карточка «в руке» — поднять её визуально. */
  readonly floating?: boolean;
  /** Оригинал, пока копию тащат. */
  readonly ghost?: boolean;
}

/**
 * Как карточка выглядеть.
 *
 * Отдельно от обёртки перетаскивания: ровно эту разметку рисовать DragOverlay,
 * чтобы карточка «в руке» выглядеть так же, как на доске.
 */
export function LaptopCardBody({
  item,
  now,
  onOpenHistory,
  floating = false,
  ghost = false,
}: LaptopCardBodyProps) {
  const { laptop, model } = item;
  const accent = STATUS_ACCENT[laptop.status];

  // Всё про правила карточка спрашивать у домена:
  const deadline = returnDeadline(laptop);
  const isDeadEnd = availableTransitions(laptop, { now }).length === 0;

  const msLeft = deadline === null ? null : deadline.getTime() - now.getTime();
  const daysLeft = msLeft === null ? null : Math.floor(msLeft / MS_IN_DAY);

  return (
    <div
      className={cn(
        'group rounded-lg border bg-card p-3 shadow-sm transition',
        floating ? 'rotate-2 shadow-2xl ring-2 ring-ring' : 'hover:border-ring/50',
        ghost && 'opacity-35',
        isDeadEnd && !floating && 'border-dashed',
      )}
    >
      <div className="flex items-start gap-2">
        <GripVerticalIcon
          className="mt-0.5 size-4 shrink-0 text-muted-foreground/50"
          aria-hidden
        />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm leading-tight font-medium">{model}</p>
          <p className="mt-0.5 flex items-center gap-1 font-mono text-[11px] text-muted-foreground">
            <LaptopIcon className="size-3" aria-hidden />
            {laptop.id}
          </p>
        </div>
      </div>

      <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
        <Badge variant="outline" className={cn('text-[11px]', accent.badge)}>
          {STATUS_LABELS[laptop.status]}
        </Badge>

        {isDeadEnd && (
          <Badge
            variant="outline"
            className="border-rose-500/30 bg-rose-500/10 text-[11px] text-rose-300"
          >
            <BanIcon className="size-3" aria-hidden />
            тупик
          </Badge>
        )}
      </div>

      {deadline !== null && daysLeft !== null && (
        <p
          className={cn(
            'mt-2 flex items-start gap-1.5 text-[11px] leading-snug',
            daysLeft < 0 ? 'text-rose-400' : 'text-muted-foreground',
          )}
        >
          <ClockIcon className="mt-px size-3 shrink-0" aria-hidden />
          <span>
            {daysLeft < 0
              ? `срок возврата истёк ${formatDateTime(deadline)}`
              : daysLeft === 0
                ? `вернуть можно только сегодня, до ${formatDateTime(deadline)}`
                : `вернуть до ${formatDateTime(deadline)} — осталось ${formatDayCount(daysLeft)}`}
          </span>
        </p>
      )}

      {onOpenHistory !== undefined && (
        <Button
          variant="ghost"
          size="sm"
          className="mt-2 h-7 w-full justify-start px-2 text-[11px] text-muted-foreground"
          // Тащить с кнопки «история» не начинать.
          onPointerDown={(event) => event.stopPropagation()}
          onClick={() => onOpenHistory(laptop.id)}
        >
          <HistoryIcon className="size-3" aria-hidden />
          история: {laptop.history.length}
        </Button>
      )}
    </div>
  );
}

interface DraggableLaptopCardProps {
  readonly item: BoardLaptop;
  readonly now: Date;
  readonly onOpenHistory: (laptopId: string) => void;
}

/** Карточка на доске: та же разметка плюс обвязка таскания. */
export function DraggableLaptopCard({ item, now, onOpenHistory }: DraggableLaptopCardProps) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: item.laptop.id });

  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      className="cursor-grab touch-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      aria-label={`${item.model}, статус «${STATUS_LABELS[item.laptop.status]}». Пробел — взять карточку, стрелки — выбрать колонку.`}
    >
      <LaptopCardBody item={item} now={now} onOpenHistory={onOpenHistory} ghost={isDragging} />
    </div>
  );
}
