import type { LaptopStatus } from '@domain';

/**
 * Цвета статусов.
 *
 * Одно место, где у статуса появляться цвет. Домен про цвета не знать: он
 * давать подписи и граф, а чем красить — решать интерфейс.
 */
export interface StatusAccent {
  /** Классы бейджа. */
  readonly badge: string;
  /** Точка в заголовке колонки. */
  readonly dot: string;
  /** Подсветка колонки в покое. */
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
