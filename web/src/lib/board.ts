import {
  ALL_STATUSES,
  MS_IN_DAY,
  changeStatus,
  type Laptop,
  type LaptopStatus,
  type TransitionError,
} from '@domain';
import { useCallback, useEffect, useState } from 'react';

import {
  addLaptop,
  fetchBoard,
  moveLaptop,
  resetBoard,
  type Board,
  type BoardLaptop,
} from './api';

/**
 * Состояние доски.
 *
 * Правил автомата тут нет. Домен звать в одном месте — `evaluateTargets`, и
 * только ради мгновенной подсказки при перетаскивании. Главный — сервер: он
 * звать тот же changeStatus. Ответы разойтись (доску поменяли в другой
 * вкладке) — побеждать сервер, доска перерисоваться его данными.
 */

/** Что домен сказать про одну колонку. */
export interface TargetVerdict {
  readonly to: LaptopStatus;
  readonly allowed: boolean;
  readonly error: TransitionError | null;
}

export function evaluateTargets(laptop: Laptop, now: Date): readonly TargetVerdict[] {
  return ALL_STATUSES.map((to) => {
    const result = changeStatus(laptop, to, { now });
    return { to, allowed: result.ok, error: result.ok ? null : result.error };
  });
}

/**
 * Сдвиг часов хранить в localStorage: перезагрузка не должна швырять человека
 * в «сегодня» посреди опыта со сроком. Сами данные жить в SQLite — часы это
 * только точка зрения на них.
 */
const CLOCK_OFFSET_KEY = 'laptop-board:clock-offset-ms';

function readStoredOffset(): number {
  const raw = window.localStorage.getItem(CLOCK_OFFSET_KEY);
  if (raw === null) {
    return 0;
  }
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : 0;
}

function storeOffset(offsetMs: number): void {
  if (offsetMs === 0) {
    window.localStorage.removeItem(CLOCK_OFFSET_KEY);
  } else {
    window.localStorage.setItem(CLOCK_OFFSET_KEY, String(offsetMs));
  }
}

export interface BoardController {
  readonly laptops: readonly BoardLaptop[];
  readonly attempts: Board['attempts'];
  readonly now: Date;
  /** Часы сдвинуты от настоящего времени. */
  readonly clockShifted: boolean;
  readonly loading: boolean;
  readonly loadError: string | null;
  readonly move: (laptopId: string, to: LaptopStatus) => Promise<void>;
  readonly add: () => Promise<void>;
  readonly reset: () => Promise<void>;
  readonly shiftClock: (days: number) => void;
  readonly setClock: (now: Date) => void;
  readonly resetClock: () => void;
  readonly reload: () => Promise<void>;
}

export interface BoardCallbacks {
  readonly onSuccess: (message: string) => void;
  readonly onFailure: (code: string, message: string) => void;
}

export function useBoard(callbacks: BoardCallbacks): BoardController {
  const [board, setBoard] = useState<Board>({ laptops: [], attempts: [] });
  const [offsetMs, setOffsetMs] = useState<number>(() => readStoredOffset());
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const now = new Date(Date.now() + offsetMs);

  const reload = useCallback(async () => {
    try {
      setBoard(await fetchBoard());
      setLoadError(null);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const { onSuccess, onFailure } = callbacks;

  const move = useCallback(
    async (laptopId: string, to: LaptopStatus) => {
      const current = board.laptops.find((item) => item.laptop.id === laptopId);
      if (current === undefined) {
        return;
      }

      try {
        const result = await moveLaptop({
          id: laptopId,
          to,
          now: new Date(Date.now() + offsetMs),
          // Версия строки: ноутбук поменяли в другой вкладке — сервер
          // ответить 409, а не затереть чужое.
          expectedVersion: current.version,
        });

        if (result.ok) {
          setBoard(result.board);
          onSuccess(`${current.model}: статус изменён`);
          return;
        }

        if (result.board !== null) {
          setBoard(result.board);
        }
        onFailure(result.error.code, result.error.message);
      } catch (error) {
        onFailure('NETWORK_ERROR', error instanceof Error ? error.message : String(error));
      }
    },
    [board.laptops, offsetMs, onSuccess, onFailure],
  );

  const add = useCallback(async () => {
    try {
      const { board: next, createdId } = await addLaptop();
      setBoard(next);
      const created = next.laptops.find((item) => item.laptop.id === createdId);
      onSuccess(`Приехал ${created?.model ?? createdId}`);
    } catch (error) {
      onFailure('NETWORK_ERROR', error instanceof Error ? error.message : String(error));
    }
  }, [onSuccess, onFailure]);

  const reset = useCallback(async () => {
    try {
      setBoard(await resetBoard());
      setOffsetMs(0);
      storeOffset(0);
    } catch (error) {
      onFailure('NETWORK_ERROR', error instanceof Error ? error.message : String(error));
    }
  }, [onFailure]);

  const shiftClock = useCallback((days: number) => {
    setOffsetMs((previous) => {
      const next = previous + days * MS_IN_DAY;
      storeOffset(next);
      return next;
    });
  }, []);

  const setClock = useCallback((value: Date) => {
    const next = value.getTime() - Date.now();
    storeOffset(next);
    setOffsetMs(next);
  }, []);

  const resetClock = useCallback(() => {
    storeOffset(0);
    setOffsetMs(0);
  }, []);

  return {
    laptops: board.laptops,
    attempts: board.attempts,
    now,
    clockShifted: Math.abs(offsetMs) > 1000,
    loading,
    loadError,
    move,
    add,
    reset,
    shiftClock,
    setClock,
    resetClock,
    reload,
  };
}
