/**
 * Каталог моделей.
 *
 * Жить на сервере, рядом с таблицей. Домен про него не знать: автомат про
 * статусы, не про ассортимент. Каталог уедет в чужой сервис — менять только
 * этот файл.
 */

const MODELS: readonly string[] = [
  'Lenovo ThinkPad X1 Carbon',
  'Lenovo ThinkPad T14s',
  'Lenovo Yoga Slim 7i',
  'Lenovo Legion 5 Pro',
  'Dell XPS 13 Plus',
  'Dell XPS 15',
  'Dell Latitude 7450',
  'Dell Precision 5690',
  'HP EliteBook 1040',
  'HP Spectre x360 14',
  'HP ProBook 460',
  'ASUS ZenBook S 14',
  'ASUS ROG Zephyrus G14',
  'ASUS Vivobook Pro 15',
  'Acer Swift Go 14',
  'Acer Predator Helios 16',
  'MSI Prestige 16 AI',
  'Apple MacBook Air 15"',
  'Apple MacBook Pro 14"',
  'Apple MacBook Pro 16"',
  'Huawei MateBook X Pro',
  'Samsung Galaxy Book5 Pro',
  'Framework Laptop 13',
];

const VARIANTS: readonly string[] = [
  '',
  ' Gen 12',
  ' Gen 13',
  ' (2026)',
  ' OLED',
  ' Touch',
  ' Ultra 7',
  ' i7',
  ' M4 Pro',
];

function pick<T>(items: readonly T[], random: () => number): T {
  // Длину проверять не надо: оба списка — непустые константы модуля.
  return items[Math.floor(random() * items.length)] as T;
}

/**
 * Случайное название.
 *
 * Генератор случайности передавать параметром, чтобы тест получил
 * предсказуемый ответ без подмены глобального Math.random. Та же причина,
 * по которой домен брать `options.now`.
 */
export function randomModelName(random: () => number = Math.random): string {
  return `${pick(MODELS, random)}${pick(VARIANTS, random)}`;
}
