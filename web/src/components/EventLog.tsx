import { STATUS_LABELS } from '@domain';
import { ChevronLeftIcon, ChevronRightIcon, CircleCheckIcon, CircleSlashIcon } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type { AttemptsPage } from '@/lib/api';
import { formatDateTime, humanizeDates } from '@/lib/format';
import { cn } from '@/lib/utils';

interface EventLogProps {
  readonly page: AttemptsPage;
  readonly resolveModel: (laptopId: string) => string;
  readonly onGoTo: (offset: number) => void;
}

/**
 * Журнал попыток, и отказы тоже.
 *
 * Отказ в историю ноутбука не попадать — её ведёт домен, там только
 * случившееся. Но для аудита важны именно отказы. Лежать в отдельной таблице,
 * поэтому переживать перезагрузку.
 *
 * Страницами, а не «последние сто». Сто было молчаливым обрезанием: запись
 * сто первая и дальше просто пропадать, и никто об этом не узнать.
 */
export function EventLog({ page, resolveModel, onGoTo }: EventLogProps) {
  const { items, total, limit, offset } = page;

  const pageCount = Math.max(1, Math.ceil(total / limit));
  const pageNumber = Math.floor(offset / limit) + 1;
  const first = total === 0 ? 0 : offset + 1;
  const last = offset + items.length;

  return (
    <div className="rounded-xl border bg-card">
      {total === 0 ? (
        <p className="px-4 py-16 text-center text-sm text-muted-foreground">Пока пусто</p>
      ) : (
        <>
          <ScrollArea className="h-[34rem]">
            <Table>
              <TableHeader className="sticky top-0 bg-card">
                <TableRow>
                  <TableHead className="w-10">#</TableHead>
                  <TableHead className="w-44">Ноутбук</TableHead>
                  <TableHead className="w-48">Переход</TableHead>
                  <TableHead className="w-44">Код</TableHead>
                  <TableHead>Ответ домена</TableHead>
                  <TableHead className="w-28 text-right">Часы модели</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((entry) => (
                  <TableRow key={entry.id} className={cn(!entry.ok && 'bg-rose-500/5')}>
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      {entry.id}
                    </TableCell>
                    <TableCell className="text-xs">
                      <span className="block truncate">{resolveModel(entry.laptopId)}</span>
                      <span className="font-mono text-[10px] text-muted-foreground">
                        {entry.laptopId}
                      </span>
                    </TableCell>
                    <TableCell className="text-xs whitespace-nowrap">
                      {STATUS_LABELS[entry.from]} → {STATUS_LABELS[entry.to]}
                    </TableCell>
                    <TableCell>
                      <span
                        className={cn(
                          'inline-flex items-center gap-1.5 font-mono text-[10px]',
                          entry.ok ? 'text-emerald-400' : 'text-rose-400',
                        )}
                      >
                        {entry.ok ? (
                          <CircleCheckIcon className="size-3.5 shrink-0" aria-hidden />
                        ) : (
                          <CircleSlashIcon className="size-3.5 shrink-0" aria-hidden />
                        )}
                        {entry.errorCode ?? 'OK'}
                      </span>
                    </TableCell>
                    {/* whitespace-normal бить nowrap из TableCell: текст домена
                        длинный, он должен переноситься, а не обрезаться. */}
                    <TableCell className="min-w-80 text-xs leading-snug whitespace-normal text-muted-foreground">
                      {humanizeDates(entry.message)}
                    </TableCell>
                    <TableCell className="text-right font-mono text-[10px] whitespace-nowrap text-muted-foreground">
                      {formatDateTime(entry.modelNow)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </ScrollArea>

          <footer className="flex flex-wrap items-center justify-between gap-3 border-t px-4 py-3">
            {/* Точные числа, а не «показаны последние». Сколько всего записей —
                читатель должен видеть, иначе страница врать умолчанием. */}
            <p className="font-mono text-[11px] text-muted-foreground">
              {first}–{last} из {total}
            </p>

            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={offset === 0}
                onClick={() => onGoTo(Math.max(0, offset - limit))}
              >
                <ChevronLeftIcon className="size-3.5" aria-hidden />
                Назад
              </Button>

              <span className="font-mono text-[11px] text-muted-foreground">
                {pageNumber} / {pageCount}
              </span>

              <Button
                variant="outline"
                size="sm"
                disabled={last >= total}
                onClick={() => onGoTo(offset + limit)}
              >
                Вперёд
                <ChevronRightIcon className="size-3.5" aria-hidden />
              </Button>
            </div>
          </footer>
        </>
      )}
    </div>
  );
}
