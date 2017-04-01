/// <reference path="../typings/globals/mocha/index.d.ts" />
import {assert} from "chai";
import {MarbleEngine, just, evolving} from "../src";

describe("test", () => {
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

  it("disposes streams in cycles when keep$ becomes false", () => {
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
  });
});

function toMap<T>(obj: { [key: string]: T }) {
  return new Map<string, T>(Object.keys(obj).map((key): [string, T] => [key, obj[key]]));
}

function toObject<T>(map: Map<string, T>) {
  const obj: { [key: string]: T } = {};
  map.forEach((value, key) => obj[key] = value);
  return obj;
}
