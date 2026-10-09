import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** Хелпер shadcn/ui: склеивает классы и разрешает конфликты Tailwind. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
