import { ArrowRightIcon } from 'lucide-react';
import { STATUS_LABELS } from '@domain';

import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type { BoardLaptop } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { STATUS_ACCENT } from '@/lib/statusStyles';
import { cn } from '@/lib/utils';

interface HistoryDialogProps {
  readonly item: BoardLaptop | null;
  readonly onClose: () => void;
}

/**
 * Журнал изменений одного ноутбука — то, что ТЗ требует записывать:
 * какой статус был, какой стал, дата. Хранится в таблице `status_history`,
 * защищённой от изменения и удаления триггерами.
 */
export function HistoryDialog({ item, onClose }: HistoryDialogProps) {
  const history = item?.laptop.history ?? [];

  return (
    <Dialog open={item !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{item?.model ?? ''}</DialogTitle>
          <DialogDescription>
            {item === null
              ? ''
              : `${item.laptop.id} — история изменений статуса, ${history.length} шт.`}
          </DialogDescription>
        </DialogHeader>

        {item !== null && history.length === 0 && (
          <p className="py-6 text-center text-sm text-muted-foreground">
            Статус ещё не менялся — журнал пуст.
          </p>
        )}

        {history.length > 0 && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">#</TableHead>
                <TableHead>Было</TableHead>
                <TableHead className="w-8" />
                <TableHead>Стало</TableHead>
                <TableHead className="text-right">Дата</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {history.map((change, index) => (
                <TableRow key={`${change.at.toISOString()}-${index}`}>
                  <TableCell className="font-mono text-xs text-muted-foreground">
                    {index + 1}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant="outline"
                      className={cn('text-[11px]', STATUS_ACCENT[change.from].badge)}
                    >
                      {STATUS_LABELS[change.from]}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <ArrowRightIcon className="size-3.5 text-muted-foreground" aria-hidden />
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant="outline"
                      className={cn('text-[11px]', STATUS_ACCENT[change.to].badge)}
                    >
                      {STATUS_LABELS[change.to]}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right text-xs whitespace-nowrap">
                    {formatDateTime(change.at)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </DialogContent>
    </Dialog>
  );
}
