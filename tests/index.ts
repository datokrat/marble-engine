/// <reference path="../typings/globals/mocha/index.d.ts" />
import {assert} from "chai";
import {MarbleEngine, Stream, Maybe, isJust, just, nothing, evolving} from "../src";

describe("test", () => {
  /*it("creates a source stream", () => {
    const engine = new MarbleEngine();
    const source$ = engine.source<string>("source");
  });

  it("derives multiple streams from a source", () => {
    const engine = new MarbleEngine("engine");
    const source$ = engine.source<string>("source");
    const exclamation$ = source$.map(str => `${str}!`);
    const question$ = source$.map(str => `${str}?`);

    const buffer = engine.collect(toMap({exclamation$}))

    engine.nextTick(() => source$.setValue(just("Hello World")));

    assert.deepEqual(buffer.map(toObject), [{exclamation$: just("Hello World!")}]);
  });

  it("evolves components", () => {
    const engine = new MarbleEngine("engine");
    const component$ = evolving(engine, current => engine.constantly(current), "String");
    const log$ = component$.map(str => "MESSAGE> " + str);

    const buffer = engine.collect(toMap({log$}));

    engine.nextTick(() => {});
    engine.nextTick(() => {});
    engine.nextTick(() => {});

    assert.deepEqual(buffer.map(toObject), [
      { log$: just("MESSAGE> String") },
      { log$: just("MESSAGE> String") },
      { log$: just("MESSAGE> String") }
    ]);
  });

  it("disposes an unused 'never' stream", () => {
    const engine = new MarbleEngine("engine");
    const keep$ = engine.source<boolean>("keep-source");
    const initialRegistered = engine.getClock().getRegistered();
    const never$ = engine.never();
    const x$ = never$.map(nev => nev, "just another never stream", self => keep$);

    const buffer = engine.collect(toMap({x$, never$}));

    engine.nextTick(() => keep$.setValue(just(false)));
    engine.nextTick(() => {});

    assert.notInclude(engine.getClock().getRegistered(), never$);
    assert.strictEqual(initialRegistered.length, engine.getClock().getRegistered().length);

    assert.deepEqual(buffer.map(toObject), [
      {x$: nothing(), never$: nothing()},
      {}
    ]);
  });

  it("does not emit in cycles when keep$ becomes false", () => {
    const engine = new MarbleEngine("engine");
    const component$ = evolving(engine, current => engine.constantly(current), "String");
    const keep$ = engine.source<boolean>("keep-source");
    const log$ = component$.map(str => `MESSAGE> ${str}`, "log", self => keep$);

    const buffer = engine.collect(toMap({log$}));

    engine.nextTick(() => {});
    engine.nextTick(() => {});
    engine.nextTick(() => keep$.setValue(just(true)));
    engine.nextTick(() => keep$.setValue(just(true)));
    engine.nextTick(() => keep$.setValue(just(false)));
    engine.nextTick(() => keep$.setValue(just(true)));
    engine.nextTick(() => {});

    assert.deepEqual(buffer.map(toObject), [
      { log$: just("MESSAGE> String") },
      { log$: just("MESSAGE> String") },
      { log$: just("MESSAGE> String") },
      { log$: just("MESSAGE> String") },
      { log$: just("MESSAGE> String") },
      {},
      {}
    ]);
  });*/

  /*it("has no space-time leaks from switching", () => {
    const engine = new MarbleEngine();
    const component$ = evolving(engine, current => engine.constantly(current), "String");
    const log$ = component$.map(str => `MESSAGE> ${str}`, "log", self => engine.never("keep:log", self => self));

    [1,2,3,4,5,6,7,8,9,10].forEach((_, i) => {
      const before = engine.getClock().getRegistered();
      engine.nextTick(() => {});
      const after = engine.getClock().getRegistered();
      console.log(`Iteration ${i}: ${before.length} -> ${after.length}`);
      console.log(`\t{after}\\{before} = Array(${minus(after, before).length}) = ${minus(after, before).map(x => x["debugString"])}`);
    });
  });*/

  it("has no space-time leaks from switching", () => {
    const engine = new MarbleEngine();
    const meta$ = engine.source<Stream<string>>("meta");
    const result$ = meta$.switch();

    array(10).forEach((_, i) => {
      const before = engine.getClock().getRegistered();
      engine.nextTick(() => {
        meta$.setValue(just(engine.constantly("Hi")));
      });
      const after = engine.getClock().getRegistered();
      console.log(`Iteration ${i}: ${before.length} -> ${after.length}`);
      console.log(`\t{after}\\{before} = Array(${minus(after, before).length}) = ${minus(after, before).map(x => x["debugString"])}`);
    });
  });
});

const unfold = <T, U>(generator: (state: U) => Maybe<[T, U]>) => (seed: U) => {
  const ret: T[] = [];
  let intermediate = generator(seed);
  while (isJust(intermediate)) {
    ret.push(intermediate.value[0]);
    intermediate = generator(intermediate.value[1]);
  }
  return ret;
};

const array = unfold((remaining: number) => (remaining > 0) ? just<[any, number]>([null, remaining - 1]) : nothing());

function minus<T>(minuend: T[], subtrahend: T[]) {
  return minuend
    .filter(t => subtrahend.indexOf(t) === -1);
}

function toMap<T>(obj: { [key: string]: T }) {
  return new Map<string, T>(Object.keys(obj).map((key): [string, T] => [key, obj[key]]));
}

function toObject<T>(map: Map<string, T>) {
  const obj: { [key: string]: T } = {};
  map.forEach((value, key) => obj[key] = value);
  return obj;
}

function toArray<T>(set: Set<T>) {
  const arr: T[] = [];
  set.forEach(it => arr.push(it));
  return arr;
}
