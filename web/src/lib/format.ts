/**
 * Писать для человека.
 *
 * Домен в ошибках давать ISO-8601 UTC: одинаковый везде, от локали сервера
 * не зависеть, тест может закрепить. Превратить это в «14 окт., 13:00»
 * в таймзоне человека — дело интерфейса, то есть этого файла.
 */

const dateTimeFormat = new Intl.DateTimeFormat('ru-RU', {
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
});

export function formatDateTime(date: Date): string {
  return dateTimeFormat.format(date);
}

/** «день / дня / дней» — тоже забота интерфейса, не домена. */
function pluralizeDays(count: number): string {
  const mod10 = count % 10;
  const mod100 = count % 100;

  if (mod10 === 1 && mod100 !== 11) {
    return 'день';
  }
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) {
    return 'дня';
  }
  return 'дней';
}

export function formatDayCount(count: number): string {
  return `${count} ${pluralizeDays(count)}`;
}
