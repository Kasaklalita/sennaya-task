import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** Хелпер shadcn/ui: склеить классы, разрулить спор Tailwind. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
