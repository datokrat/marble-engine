export type Maybe<T> = Nothing | Just<T>;
export interface Nothing { type: "nothing", toString: () => string }
export interface Just<T> { type: "just", value: T, toString: () => string }
export function nothing(): Nothing { return { type: "nothing", toString: nothingToString } }
export function just<T>(value: T): Just<T> { return { type: "just", value, toString: justToString } };
export function isJust<T>(m: Maybe<T>): m is Just<T> { return m.type === "just" }
export function hasValue<T>(m: Maybe<T>, t: T) { return isJust(m) && m.value === t }
export function hasMatchingValue<T>(m: Maybe<T>, predicate: (t: T) => boolean) { return isJust(m) && predicate(m.value) }
export function valueOrUndefined<T>(m: Maybe<T>) { return isJust(m) ? m.value : undefined }
export function isNothing<T>(m: Maybe<T>): m is Nothing { return m.type === "nothing" }
export function maybe<T>(): Maybe<T> { return nothing() }
export function valueOrNull<T>(m: Maybe<T>): T | null { return isJust(m) ? m.value : null }

function justToString<T>(this: Just<T>) {
  return `just(${this.value.toString()})`;
}

function nothingToString<T>(this: Nothing) {
  return "nothing";
}
