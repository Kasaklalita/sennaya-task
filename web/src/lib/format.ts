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

/** То же, но с годом. Для текстов ошибок: там дата без года путать. */
const dateTimeWithYearFormat = new Intl.DateTimeFormat('ru-RU', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

/** Метка времени ISO-8601 UTC — ровно в том виде, в каком её печатать домен. */
const ISO_TIMESTAMP = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/g;

/**
 * Переписать все ISO-даты в тексте домена на человеческие.
 *
 * Домен печатать `2026-10-03T10:31:17.202Z`: формат одинаковый везде, от локали
 * сервера не зависеть, тест может закрепить его дословно. Но читать такое
 * человеку невозможно, а текст ошибки показывать именно человеку.
 *
 * Поэтому перевод живёт тут, в презентационном слое: у него есть таймзона
 * конкретного человека, а у домена её нет и быть не должно.
 *
 * Почему по тексту, а не по структурированным полям ошибки: до журнала попыток
 * доезжать уже готовая строка из базы — полей там нет. Один способ на все три
 * места (подсказка при таскании, тост, журнал) даёт одинаковый результат везде.
 */
export function humanizeDates(text: string): string {
  return text.replace(ISO_TIMESTAMP, (iso) => {
    const date = new Date(iso);
    return Number.isNaN(date.getTime()) ? iso : dateTimeWithYearFormat.format(date);
  });
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
