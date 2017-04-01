import {MarbleEngine, Stream} from "./stream";

export function evolving<T>(engine: MarbleEngine, evolve: (current: T) => Stream<T>, initial: T): Stream<T> {
  const result$ = engine.mimic<T>("evolutionResult");
  const mimic$ = engine.mimic<T>("evolutionMimic");
  const $ = mimic$
    .fold((_, t) => evolve(t), evolve(initial))
    .switch()
    .fold((_, x) => x, initial, undefined, _ => result$.keep$);
  mimic$.imitate($);
  result$.imitate($);
  return result$;
}
