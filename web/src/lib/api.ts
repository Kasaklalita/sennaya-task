import { createLaptop, type Laptop, type LaptopStatus } from '@domain';

/**
 * Клиент API.
 *
 * Здесь проходит граница сети: по проводу ходят DTO с датами-строками, а внутрь
 * приложения попадают уже доменные агрегаты. Сборка идёт через `createLaptop`
 * из домена — тот же конструктор, что использует сервер, поэтому объект
 * в браузере получает те же гарантии: он заморожен, даты скопированы.
 */

export interface AttemptView {
  readonly id: number;
  readonly laptopId: string;
  readonly from: LaptopStatus;
  readonly to: LaptopStatus;
  readonly ok: boolean;
  readonly errorCode: string | null;
  readonly message: string;
  readonly modelNow: Date;
}

/** Агрегат плюс то, чего домен не знает: каталожное имя и версия строки. */
export interface BoardLaptop {
  readonly laptop: Laptop;
  readonly model: string;
  readonly version: number;
}

export interface Board {
  readonly laptops: readonly BoardLaptop[];
  readonly attempts: readonly AttemptView[];
}

export interface ApiError {
  readonly code: string;
  readonly message: string;
}

interface StatusChangeDto {
  readonly from: LaptopStatus;
  readonly to: LaptopStatus;
  readonly at: string;
}

interface LaptopDto {
  readonly id: string;
  readonly model: string;
  readonly status: LaptopStatus;
  readonly version: number;
  readonly soldAt: string | null;
  readonly history: readonly StatusChangeDto[];
}

interface AttemptDto {
  readonly id: number;
  readonly laptopId: string;
  readonly from: LaptopStatus;
  readonly to: LaptopStatus;
  readonly ok: boolean;
  readonly errorCode: string | null;
  readonly message: string;
  readonly modelNow: string;
}

interface BoardDto {
  readonly laptops: readonly LaptopDto[];
  readonly attempts: readonly AttemptDto[];
}

function toBoardLaptop(dto: LaptopDto): BoardLaptop {
  return {
    model: dto.model,
    version: dto.version,
    laptop: createLaptop({
      id: dto.id,
      status: dto.status,
      history: dto.history.map((change) => ({
        from: change.from,
        to: change.to,
        at: new Date(change.at),
      })),
      ...(dto.soldAt === null ? {} : { soldAt: new Date(dto.soldAt) }),
    }),
  };
}

function toBoard(dto: BoardDto): Board {
  return {
    laptops: dto.laptops.map(toBoardLaptop),
    attempts: dto.attempts.map((attempt) => ({
      ...attempt,
      modelNow: new Date(attempt.modelNow),
    })),
  };
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw new Error(`Сервер ответил ${response.status}, но тело не является JSON.`);
  }
}

export async function fetchBoard(): Promise<Board> {
  const response = await fetch('/api/board');
  const body = await readJson(response);

  if (!response.ok) {
    throw new Error((body as { error?: ApiError }).error?.message ?? 'Не удалось загрузить доску');
  }

  return toBoard(body as BoardDto);
}

export type MoveResult =
  | { readonly ok: true; readonly board: Board }
  | { readonly ok: false; readonly error: ApiError; readonly board: Board | null };

export async function moveLaptop(params: {
  readonly id: string;
  readonly to: LaptopStatus;
  readonly now: Date;
  readonly expectedVersion: number;
}): Promise<MoveResult> {
  const response = await fetch(`/api/laptops/${encodeURIComponent(params.id)}/status`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      to: params.to,
      now: params.now.toISOString(),
      expectedVersion: params.expectedVersion,
    }),
  });

  const body = (await readJson(response)) as { board?: BoardDto; error?: ApiError };

  if (response.ok && body.board !== undefined) {
    return { ok: true, board: toBoard(body.board) };
  }

  return {
    ok: false,
    error: body.error ?? { code: 'UNKNOWN', message: `Сервер ответил ${response.status}` },
    // Доска приходит и вместе с отказом — клиенту не нужен второй запрос,
    // чтобы увидеть актуальное состояние.
    board: body.board === undefined ? null : toBoard(body.board),
  };
}

/**
 * Добавляет новый ноутбук. Название модели и идентификатор выдаёт сервер —
 * каталог живёт рядом с таблицей, а не в интерфейсе.
 */
export async function addLaptop(): Promise<{ board: Board; createdId: string }> {
  const response = await fetch('/api/laptops', { method: 'POST' });
  const body = await readJson(response);

  if (!response.ok) {
    throw new Error(
      (body as { error?: ApiError }).error?.message ?? 'Не удалось добавить ноутбук',
    );
  }

  const payload = body as { board: BoardDto; createdId: string };
  return { board: toBoard(payload.board), createdId: payload.createdId };
}

export async function resetBoard(): Promise<Board> {
  const response = await fetch('/api/reset', { method: 'POST' });
  const body = await readJson(response);

  if (!response.ok) {
    throw new Error((body as { error?: ApiError }).error?.message ?? 'Не удалось сбросить доску');
  }

  return toBoard((body as { board: BoardDto }).board);
}
