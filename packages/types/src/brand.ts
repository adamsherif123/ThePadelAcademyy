/**
 * Nominal typing helper. `Brand<T, B>` is structurally `T` at runtime (zero cost)
 * but distinct at the type level, so a `PlayerId` cannot be passed where a
 * `CoachId` is expected, and a raw `number` cannot be passed where `Piastres` is.
 *
 * This file — like every file in @tpa/types — must emit NO JavaScript.
 */
export type Brand<T, B extends string> = T & { readonly __brand: B };
