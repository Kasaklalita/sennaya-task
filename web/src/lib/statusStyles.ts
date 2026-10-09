import type { LaptopStatus } from '@domain';

/**
 * Визуальный словарь статусов.
 *
 * Единственное место, где у статуса появляется цвет. Сам домен о цветах не знает —
 * он отдаёт `STATUS_LABELS` и граф, а как это раскрасить, решает интерфейс.
 */
export interface StatusAccent {
  /** Классы бейджа статуса. */
  readonly badge: string;
  /** Точка-маркер в заголовке колонки. */
  readonly dot: string;
  /** Подсветка колонки в обычном состоянии. */
  readonly column: string;
}

export const STATUS_ACCENT = {
  IN_STOCK: {
    badge: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300',
    dot: 'bg-emerald-400',
    column: 'border-emerald-500/20',
  },
  RESERVED: {
    badge: 'border-amber-500/30 bg-amber-500/10 text-amber-300',
    dot: 'bg-amber-400',
    column: 'border-amber-500/20',
  },
  SOLD: {
    badge: 'border-sky-500/30 bg-sky-500/10 text-sky-300',
    dot: 'bg-sky-400',
    column: 'border-sky-500/20',
  },
  WRITTEN_OFF: {
    badge: 'border-zinc-500/30 bg-zinc-500/10 text-zinc-400',
    dot: 'bg-zinc-500',
    column: 'border-zinc-500/20',
  },
} as const satisfies Record<LaptopStatus, StatusAccent>;
