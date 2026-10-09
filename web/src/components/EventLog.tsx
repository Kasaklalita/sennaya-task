import { STATUS_LABELS } from '@domain';
import { CircleCheckIcon, CircleSlashIcon } from 'lucide-react';

import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type { AttemptView } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { cn } from '@/lib/utils';

interface EventLogProps {
  readonly entries: readonly AttemptView[];
  readonly resolveModel: (laptopId: string) => string;
}

/**
 * Журнал попыток — включая отклонённые.
 *
 * Отклонённые переходы в историю ноутбука не попадают (её ведёт домен, и там
 * только случившиеся изменения), но для аудита важны именно они. Хранится
 * в отдельной таблице `transition_attempts`, поэтому переживает перезагрузку
 * страницы вместе со всем остальным.
 */
export function EventLog({ entries, resolveModel }: EventLogProps) {
  return (
    <div className="rounded-xl border bg-card">
      {entries.length === 0 ? (
        <p className="px-4 py-16 text-center text-sm text-muted-foreground">Пока пусто</p>
      ) : (
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
              {entries.map((entry) => (
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
                  {/* whitespace-normal переопределяет nowrap из TableCell:
                      сообщения домена длинные и должны переноситься, а не обрезаться. */}
                  <TableCell className="min-w-80 text-xs leading-snug whitespace-normal text-muted-foreground">
                    {entry.message}
                  </TableCell>
                  <TableCell className="text-right font-mono text-[10px] whitespace-nowrap text-muted-foreground">
                    {formatDateTime(entry.modelNow)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </ScrollArea>
      )}
    </div>
  );
}
