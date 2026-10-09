import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    // node:sqlite встроен в Node, но помечен экспериментальным и печатает
    // предупреждение на каждый импорт. Вывод тестов должен оставаться читаемым.
    // (В Vitest 5 execArgv — опция верхнего уровня, не poolOptions.)
    pool: 'forks',
    execArgv: ['--disable-warning=ExperimentalWarning'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts', 'server/**/*.ts'],
      // Точка входа процесса: только сборка зависимостей, listen и обработка
      // сигналов. Логики там нет, а «покрыть» её можно лишь запуском процесса
      // ради цифры в отчёте.
      exclude: ['server/index.ts'],
      reporter: ['text', 'html'],
      thresholds: {
        // Домен маленький и полностью детерминированный — здесь 100% достижимы
        // и имеют смысл: любая непокрытая ветка это необработанный переход.
        'src/**/*.ts': {
          lines: 100,
          functions: 100,
          branches: 100,
          statements: 100,
        },
        // Серверный слой — адаптеры (SQL, HTTP). Планка высокая, но не 100%:
        // часть веток там это защита от сбоев инфраструктуры, которые честнее
        // не инсценировать ради цифры в отчёте.
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
