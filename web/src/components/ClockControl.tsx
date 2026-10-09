import { DatabaseIcon, RotateCcwIcon, TimerResetIcon } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { formatDateTime } from '@/lib/format';

interface ClockControlProps {
  readonly now: Date;
  readonly clockShifted: boolean;
  readonly onShift: (days: number) => void;
  readonly onSet: (now: Date) => void;
  readonly onResetClock: () => void;
  readonly onResetBoard: () => void;
}

const SHIFTS: ReadonlyArray<{ readonly label: string; readonly days: number }> = [
  { label: '−1 день', days: -1 },
  { label: '+1 день', days: 1 },
  { label: '+7 дней', days: 7 },
  { label: '+14 дней', days: 14 },
];

function toLocalInputValue(date: Date): string {
  const pad = (value: number): string => String(value).padStart(2, '0');
  return [
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
    `${pad(date.getHours())}:${pad(date.getMinutes())}`,
  ].join('T');
}

/**
 * Управление модельным «сейчас».
 *
 * Окно возврата — единственное правило автомата, зависящее от времени, и увидеть
 * его работу можно только сдвинув часы. Значение уходит на сервер в поле `now`
 * и попадает прямо в `options.now` домена — ровно так же, как в тестах.
 *
 * Это осознанная поблажка демонстрации: в реальной системе сервер использовал бы
 * только свои часы, потому что клиентскому времени доверять нельзя.
 */
export function ClockControl({
  now,
  clockShifted,
  onShift,
  onSet,
  onResetClock,
  onResetBoard,
}: ClockControlProps) {
  return (
    <div className="flex flex-wrap items-end gap-x-6 gap-y-4 rounded-xl border bg-card p-4">
      <div className="min-w-56">
        <p className="flex items-center gap-2 text-[11px] tracking-wide text-muted-foreground uppercase">
          Текущий момент модели
          {clockShifted && (
            <Badge
              variant="outline"
              className="border-amber-500/30 bg-amber-500/10 px-1.5 py-0 text-[10px] text-amber-300"
            >
              часы сдвинуты
            </Badge>
          )}
        </p>
        <p className="mt-1 text-xl font-semibold">{formatDateTime(now)}</p>
        <p className="font-mono text-[11px] text-muted-foreground">{now.toISOString()}</p>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label className="text-[11px] text-muted-foreground">Сдвинуть часы</Label>
        <div className="flex flex-wrap gap-1.5">
          {SHIFTS.map((shift) => (
            <Button
              key={shift.days}
              variant="outline"
              size="sm"
              onClick={() => onShift(shift.days)}
            >
              {shift.label}
            </Button>
          ))}
          <Button
            variant="ghost"
            size="sm"
            disabled={!clockShifted}
            onClick={onResetClock}
            title="Вернуть часы к настоящему времени"
          >
            <TimerResetIcon className="size-3.5" aria-hidden />
            Сейчас
          </Button>
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="clock-input" className="text-[11px] text-muted-foreground">
          Или задать точно
        </Label>
        <Input
          id="clock-input"
          type="datetime-local"
          className="w-56"
          value={toLocalInputValue(now)}
          onChange={(event) => {
            const parsed = new Date(event.target.value);
            if (!Number.isNaN(parsed.getTime())) {
              onSet(parsed);
            }
          }}
        />
      </div>

      <Button
        variant="ghost"
        size="sm"
        className="ml-auto"
        onClick={onResetBoard}
        title="Пересоздать таблицы и наполнить их заново"
      >
        <RotateCcwIcon className="size-3.5" aria-hidden />
        Сбросить базу
      </Button>

      <p className="flex w-full items-center gap-1.5 border-t pt-3 text-[11px] text-muted-foreground">
        <DatabaseIcon className="size-3.5 shrink-0" aria-hidden />
        Состояние хранится в SQLite и переживает перезагрузку страницы. Часы — это точка
        зрения на данные, а не сами данные.
      </p>
    </div>
  );
}
