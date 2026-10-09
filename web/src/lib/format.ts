/**
 * Форматирование для человека.
 *
 * Домен в сообщениях об ошибках выводит ISO-8601 UTC — детерминированно
 * и независимо от локали сервера, поэтому его можно закрепить тестом.
 * Превращать это в «14 окт., 13:00» в таймзоне пользователя — работа
 * презентационного слоя, то есть вот этого файла.
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

/** Склонение «день / дня / дней» — тоже забота интерфейса, а не домена. */
export function pluralizeDays(count: number): string {
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
