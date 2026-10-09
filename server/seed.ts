import {
  LaptopStatus,
  MS_IN_DAY,
  changeStatusOrThrow,
  createLaptop,
  type Laptop,
} from '../src/index.js';

export interface SeedLaptop {
  readonly laptop: Laptop;
  readonly model: string;
}

/**
 * Чем наполнять пустую базу.
 *
 * Истории собирать **самим доменом** — настоящими вызовами changeStatusOrThrow
 * с датами в прошлом. Поэтому в базе не оказаться состояния, до которого
 * автомат не дойти: сид проходить ту же проверку, что и клик в интерфейсе.
 */
export function buildSeed(now: Date): readonly SeedLaptop[] {
  const daysAgo = (count: number): Date => new Date(now.getTime() - count * MS_IN_DAY);

  // Продан → возвращён → продан снова: срок считать от ПОСЛЕДНЕЙ продажи.
  let resold = changeStatusOrThrow(createLaptop({ id: 'nb-006' }), LaptopStatus.Sold, {
    now: daysAgo(30),
  });
  resold = changeStatusOrThrow(resold, LaptopStatus.InStock, { now: daysAgo(25) });
  resold = changeStatusOrThrow(resold, LaptopStatus.Sold, { now: daysAgo(2) });

  return [
    {
      model: 'MacBook Air 13" M4',
      laptop: createLaptop({ id: 'nb-001' }),
    },
    {
      model: 'ThinkPad X1 Carbon Gen 13',
      laptop: changeStatusOrThrow(createLaptop({ id: 'nb-002' }), LaptopStatus.Reserved, {
        now: daysAgo(2),
      }),
    },
    {
      model: 'MacBook Pro 16" M4 Pro',
      laptop: changeStatusOrThrow(createLaptop({ id: 'nb-003' }), LaptopStatus.Sold, {
        now: daysAgo(3),
      }),
    },
    {
      // Продан 20 дней назад — срок вышел. Это «фактический тупик» из README:
      // вернуть нельзя, списать проданный ТЗ не разрешать.
      model: 'Dell XPS 15 9530',
      laptop: changeStatusOrThrow(createLaptop({ id: 'nb-004' }), LaptopStatus.Sold, {
        now: daysAgo(20),
      }),
    },
    {
      model: 'ASUS ZenBook 14 OLED',
      laptop: changeStatusOrThrow(createLaptop({ id: 'nb-005' }), LaptopStatus.WrittenOff, {
        now: daysAgo(10),
      }),
    },
    { model: 'HP EliteBook 840 G11', laptop: resold },
  ];
}
