import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    // node:sqlite встроен в Node, но помечен экспериментальным и печатать
    // предупреждение на каждый импорт. Вывод тестов должен читаться.
    // (В Vitest 5 execArgv — опция верхнего уровня, не poolOptions.)
    pool: 'forks',
    execArgv: ['--disable-warning=ExperimentalWarning'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts', 'server/**/*.ts'],
      // Вход процесса: только сборка зависимостей, listen и сигналы.
      // Логики нет, «покрыть» можно лишь запуском процесса ради цифры.
      exclude: ['server/index.ts'],
      reporter: ['text', 'html'],
      thresholds: {
        // Домен маленький и предсказуемый — тут 100% достижимы и осмысленны:
        // непокрытая ветка значит необработанный переход.
        'src/**/*.ts': {
          lines: 100,
          functions: 100,
          branches: 100,
          statements: 100,
        },
        // Сервер — адаптеры (SQL, HTTP). Планка высокая, но не 100%: часть
        // веток там защита от сбоев железа, которые честнее не изображать.
        'server/**/*.ts': {
          lines: 90,
          functions: 90,
          branches: 85,
          statements: 90,
        },
      },
    },
  },
});
