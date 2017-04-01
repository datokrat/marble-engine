import { Tickable, Clock, TickableBase, TimedMaybe, TickState, DisposedState } from "./timing";
import { Maybe, Just, just, nothing, isJust, isNothing, hasValue } from "./maybe";
import { TimingException, MultipleAssignmentsException, UnexpectedNotificationException, UnassignedSinkException } from "./exceptions";

export interface Observer {
  notify(sender: Observable, value: Maybe<any>): void;
  recipient: Maybe<CoreStream<any>>;
}

export interface Observable {
  subscribe(observer: Observer): void;
  unsubscribe(observer: Observer): void;
}

export interface CoreStream<T> extends Tickable, Observable {
  readonly debugString: string;
  getValue(): Maybe<Maybe<T>>;
}

export type Sink = Map<string, CoreStream<any>>;

export interface KeepStream extends CoreStream<boolean> {}

export abstract class StreamBase<T> extends TickableBase implements CoreStream<T> {
  // isNothing <=> using unicast
  private readonly keep$: Maybe<KeepStream>;

  protected readonly value: TimedMaybe<Maybe<T>>;

  private readonly observers = new Set<Observer>();

  constructor(clock: Clock, debugString: string, keepStream?: (self: StreamBase<T>) => KeepStream) {
    super(clock, debugString);

    if (keepStream !== undefined) {
      this.keep$ = just(keepStream(this));
    } else {
      this.keep$ = nothing();
      /* const mimic$ = new MimicStream<boolean>(clock, "keepMimic:" + debugString, self$ => self$);
      this.keep$ = mimic$;
      this.unicastKeepMimic$ = just(mimic$);*/
    }

    this.value = new TimedMaybe<Maybe<T>>(value =>
      this.observers.forEach(observer => observer.notify(this, value)), debugString + "'");
  }

  public initialize(state: TickState) {
    this.state = state;

    if (state === TickState.INITIALIZED || state === TickState.PASSIVE) {
      this.value.nextTick();
      if (isJust(this.keep$)) {
        const keepValue$ = this.keep$.value;
        this.clock.getQueue().push(() => {
          keepValue$.subscribe(this.keepObserver);
          const maybe = keepValue$.getValue();
          if (isJust(maybe)) {
            this.keepObserver.notify(keepValue$, maybe.value);
          }
        });
      }
    } else {
      if (isJust(this.keep$)) {
        this.keep$.value.subscribe(this.keepObserver);
      }
    }
  }

  private keepObserver: Observer = {
    notify: (sender: KeepStream, value: Maybe<boolean>) => {
      this.expectSenderCondition(hasValue(this.keep$, sender));

      if (isJust(value) && value.value === false) {
        this.scheduleDisposal();
      }
    },
    recipient: just(this)
  };

  protected disposeNow() {
    super.disposeNow();
    this.clock.unregister(this);
    if (isJust(this.keep$)) {
      this.keep$.value.unsubscribe(this.keepObserver);
    }
    this.observers.clear();
    this.value.dispose();
  }

  protected safeBeginTick() {
    super.safeBeginTick();
    this.value.nextTick();
  }

  public getValue() {
    return this.value.get();
  }

  public subscribe(observer: Observer) {
    this.observers.add(observer);

    if (isNothing(this.keep$) && this.observers.size > 1) {
      throw new Error(`${this.debugString} is a unicast stream but received two subscriptions.`);
    }
    /* if (isJust(this.unicastKeepMimic$)) {
      this.unicastKeepMimic$.value
        .imitate(isJust(observer.recipient) ? observer.recipient.value.keep$ : new NeverStream(this.clock, "keep-default"));
    }*/
  }

  public unsubscribe(observer: Observer) {
    if (this.observers.has(observer)) {
      this.observers.delete(observer);

      if (isNothing(this.keep$)) {
        this.scheduleDisposal();
      }
    }
  }

  protected expectSender(actual: Observable, expected: Observable) {
    this.expectSenderCondition(actual === expected);
  }

  protected expectSenderCondition(condition: boolean) {
    if (!condition) {
      throw new UnexpectedNotificationException();
    }
  }
}

export abstract class Stream<T> extends StreamBase<T> {

  public map<U>(project: (t: T) => U, debugString?: string, keepStream?: (self: Stream<U>) => KeepStream): Stream<U> {
    return new MapStream(this.clock, this, project, debugString, keepStream);
  }

  public filter(predicate: (t: T) => boolean): Stream<T> {
    return new FilterStream(this.clock, this, predicate);
  }

  public mergeWith<U>(other$: CoreStream<U>): Stream<[Maybe<T>, Maybe<U>]>;
  public mergeWith(...other$s: CoreStream<T>[]): Stream<Maybe<T>[]>;
  public mergeWith(other$: CoreStream<any>): Stream<Maybe<any>[]> {
    return new MergeStream<any>(this.clock, [this, other$]) as any;
  }

  public fold<U>(reduce: (prev: U, curr: T) => U, initialState: U, debugString?: string, keepStream?: (self: Stream<U>) => KeepStream): Stream<U> {
    return new FoldStream(this.clock, this, reduce, initialState, debugString, keepStream);
  }

  public branchFold<U>(reduce: (prev: U, curr: T) => U, initial$: CoreStream<U>): Stream<U> {
    return new BranchFoldStream(this.clock, this, reduce, initial$);
  }

  public switch(this: Stream<T & CoreStream<any>>): T {
    return new SwitchStream(this.clock, this) as any;
  }

  public flatten(this: Stream<T & CoreStream<any>>): T {
    return new FlattenStream(this.clock, this) as any;
  }

  public dropCurrent(): Stream<T> {
    return new DropCurrentStream(this.clock, this);
  }

  public compose<U>(fn: ($: this) => Stream<U>) {
    return fn(this);
  }
}

export class SourceStream<T> extends Stream<T> {

  constructor(
    clock: Clock,
    debugString: string,
    keepStream: (self: Stream<T>) => KeepStream = self => new NeverStream(clock, `never(keep:${debugString})`, self => self)) {

    super(clock, debugString, keepStream);
    this.clock.register(this);
  }

  public setValue(value: Maybe<T>) {
    this.value.set(value);
  }

  protected safeOnTick() {
    if (isNothing(this.value.get())) {
      this.value.set(nothing());
    }
  }

  public initialize(state: TickState) {
    super.initialize(state);
    if (this.state === TickState.PASSIVE) {
      this.value.set(nothing());
    }
  }
}

export class NeverStream extends Stream<never> {
  constructor(clock: Clock, debugString?: string, keepStream?: (self: Stream<never>) => KeepStream) {
    super(clock, debugString || `never`, keepStream);
    this.clock.register(this);
  }

  public initialize(state: TickState) {
    super.initialize(state);

    if (state === TickState.PASSIVE) {
      this.value.set(nothing());
    }
  }

  protected safeOnTick() {
    super.safeOnTick();

    this.value.set(nothing());
  }
}

export class MapStream<T, U> extends Stream<U> {
  constructor(
    clock: Clock,
    private readonly origin: CoreStream<T>,
    private readonly project: (t: T) => U,
    debugString = `${origin.debugString}.map`,
    keepStream?: (self: Stream<U>) => KeepStream) {

    super(clock, debugString, keepStream);
    this.clock.register(this);
  }

  private observer: Observer = {
    notify: (observable: Observable, value: Maybe<any>) => {
      this.expectSender(observable, this.origin);
      this.applyProjection(value);
    },
    recipient: just(this)
  };

  private applyProjection(value: Maybe<T>) {
    let result = isJust(value) ? just(this.project(value.value)) : nothing();
    this.value.set(result);
  }

  public initialize(state: TickState) {
    super.initialize(state);

    if (this.state === TickState.INITIALIZED || this.state === TickState.PASSIVE) {
      this.clock.getQueue().push(() => {
        const originMaybe = this.origin.getValue();
        if (isJust(originMaybe)) {
          this.applyProjection(originMaybe.value);
        }
        this.origin.subscribe(this.observer);
      });
    } else {
      this.origin.subscribe(this.observer);
    }
  }

  public disposeNow() {
    super.disposeNow();
    this.origin.unsubscribe(this.observer);
  }
}

export class FilterStream<T> extends Stream<T> {
  constructor(
    clock: Clock,
    private readonly origin: CoreStream<T>,
    private readonly predicate: (t: T) => boolean,
    keepStream?: (self: Stream<T>) => KeepStream) {

    super(clock, `${origin.debugString}.filter`, keepStream);
    this.clock.register(this);
  }

  public initialize(state: TickState) {
    super.initialize(state);

    if (this.state === TickState.INITIALIZED || this.state === TickState.PASSIVE) {
      // FIXME: what happens if called tearDown in super.initialize?
      this.clock.getQueue().push(() => {
        const originMaybe = this.origin.getValue();
        if (isJust(originMaybe)) {
          this.observer.notify(this.origin, originMaybe.value);
        }
        this.origin.subscribe(this.observer);
      });
    } else {
      this.origin.subscribe(this.observer);
    }
  }

  public disposeNow() {
    super.disposeNow();
    this.origin.unsubscribe(this.observer);
  }

  private observer: Observer = {
    notify: (observable: Observable, value: Maybe<any>) => {
      this.expectSender(observable, this.origin);
      if (isJust(value) && this.predicate(value.value)) {
        this.value.set(just(value.value));
      } else {
        this.value.set(nothing());
      }
    },
    recipient: just(this)
  };
}

export class MergeStream<T> extends Stream<Maybe<T>[]> {
  private readonly values: TimedMaybe<Maybe<T>>[];
  private readonly origins: CoreStream<T>[];

  constructor(
    clock: Clock,
    origins: CoreStream<T>[],
    debugString: string = `merge[${origins.map(o => o.debugString)}]`,
    keepStream?: (self: Stream<Maybe<T>[]>) => KeepStream) {

    super(clock, debugString, keepStream);

    this.origins = origins;
    this.values = origins.map(o => new TimedMaybe<Maybe<T>>(this.invokeIfPossible, this.debugString));

    this.clock.register(this);
  }

  public disposeNow() {
    super.disposeNow();
    this.origins.forEach((o, i) => o.unsubscribe(this.observer(i)));
  }

  protected safeBeginTick() {
    super.safeBeginTick();
    this.values.forEach(v => v.nextTick());
  }

  protected safeOnTick() {
    this.invokeIfPossible();
  }

  private observer: (i: number) => Observer = i => ({
    notify: (sender: Observable, value: Maybe<T>) => {
      this.expectSender(sender, this.origins[i]);
      this.values[i].set(value);
    },
    recipient: just(this)
  });

  private invokeIfPossible = () => {
    if (isJust(this.value.get())) {
      return;
    }

    const maybes = this.values.map(v => v.get());
    const wereAllSet = maybes.reduce((ok, maybe) => ok && isJust(maybe), true);

    if (wereAllSet) {
      const finalValues = maybes.map((m: Just<Maybe<T>>) => m.value);
      // const isNoneActive = finalValues.reduce((ok, maybe) => ok && isNothing(maybe), true);
      let value: Maybe<Maybe<T>[]> = /* isNoneActive
        ? nothing()
        : */ just<Maybe<T>[]>(finalValues);

      this.value.set(value);
    }
  }

  public initialize(state: TickState) {
    super.initialize(state);

    if (state === TickState.INITIALIZED || state === TickState.PASSIVE) {
      this.values.forEach(v => v.nextTick());

      this.clock.getQueue().push(() => {
        this.origins.forEach((o, i) => {
          const maybe = o.getValue();
          if (isJust(maybe)) {
            this.values[i].set(maybe.value);
          }
          o.subscribe(this.observer(i));
        });
      });

      this.invokeIfPossible();
    } else {
      this.origins.forEach((o, i) => o.subscribe(this.observer(i)));
    }
  }
}

export class FoldStream<T, U> extends Stream<U> {
  private foldState: U;

  constructor(
    clock: Clock,
    private readonly origin: CoreStream<T>,
    private readonly reduce: (prev: U, curr: T) => U,
    private initialValue: U,
    debugString = `${origin.debugString}.fold`,
    keepStream?: (self: Stream<U>) => KeepStream) {

    super(clock, debugString, keepStream);
    this.clock.register(this);

    this.foldState = initialValue;
  }

  private originObserver: Observer = {
    notify: (sender: Observable, curr: Maybe<T>) => {
      this.expectSender(sender, this.origin);
      if (isJust(curr)) {
        this.foldState = this.reduce(this.foldState, curr.value);
      }
      this.value.set(just(this.foldState));
    },
    recipient: just(this)
  };

  public initialize(state: TickState) {
    super.initialize(state)

    if (this.state === TickState.INITIALIZED || this.state === TickState.PASSIVE) {
      this.clock.getQueue().push(() => {
        const maybe = this.origin.getValue();
        if (isJust(maybe)) {
          this.originObserver.notify(this.origin, maybe.value);
        }
        this.origin.subscribe(this.originObserver);
      });
    } else {
      this.origin.subscribe(this.originObserver);
    }
  }

  public disposeNow() {
    super.disposeNow();
    this.origin.unsubscribe(this.originObserver);
  }
}

export class BranchFoldStream<T, U> extends Stream<U> {
  private foldState: U;
  private hasInitialValue = false;
  private hasSubscribedToAction = false;

  constructor(
    clock: Clock,
    private readonly action: CoreStream<T>,
    private reduce: (prev: U, curr: T) => U,
    private readonly initial: CoreStream<U>,
    keepStream?: (self: Stream<U>) => KeepStream) {

    super(clock, `${action.debugString}.branchFold[${initial.debugString}]`, keepStream);
    this.clock.register(this);
  }

  public initialize(state: TickState) {
    super.initialize(state);

    if (this.state === TickState.INITIALIZED || this.state === TickState.PASSIVE) {
      this.clock.getQueue().push(() => {
        const initial = this.initial.getValue();
        if (isJust(initial)) {
          this.initialObserver.notify(this.initial, initial.value);
        }
        this.initial.subscribe(this.initialObserver);
      });
    } else {
      this.initial.subscribe(this.initialObserver);
    }
  }

  public disposeNow() {
    super.disposeNow();
    this.initial.unsubscribe(this.initialObserver);
    this.action.unsubscribe(this.actionObserver);
  }

  private initialObserver: Observer = {
    notify: (sender: CoreStream<any>, value: Maybe<any>) => {
      this.expectSender(sender, this.initial);
      this.expectSenderCondition(!this.hasInitialValue);
      this.initial.unsubscribe(this.initialObserver);
      if (isJust(value)) {
        this.foldState = value.value;
        this.value.set(value);
        this.hasInitialValue = true;
      } else {
        throw new Error("Initial value is Nothing");
      }
    },
    recipient: just(this)
  };

  public safeBeginTick() {
    super.safeBeginTick();
    if (!this.hasSubscribedToAction && this.hasInitialValue) {
      this.hasSubscribedToAction = true;
      this.action.subscribe(this.actionObserver);
    }
  }

  private actionObserver: Observer = {
    notify: (sender: CoreStream<any>, value: Maybe<any>) => {
      this.expectSender(sender, this.action);
      this.expectSenderCondition(this.hasSubscribedToAction);
      if (isJust(value)) {
        this.foldState = this.reduce(this.foldState, value.value);
      }
      this.value.set(just(this.foldState));
    },
    recipient: just(this)
  };
}

export class FlattenStream<T> extends Stream<T> {
  private stream: TimedMaybe<Maybe<CoreStream<T>>> = new TimedMaybe<Maybe<CoreStream<T>>>(() => {}, this.debugString);

  constructor(
    clock: Clock,
    private readonly metaStream: CoreStream<CoreStream<T>>,
    keepStream?: (self: Stream<T>) => KeepStream) {

    super(clock, `${metaStream.debugString}.flatten`, keepStream);
    this.clock.register(this);
  }

  public initialize(state: TickState) {
    super.initialize(state);

    if (state === TickState.INITIALIZED || state === TickState.PASSIVE) {
      this.stream.nextTick();
      const metaValue = this.metaStream.getValue();
      if (isJust(metaValue)) {
        this.notifyNextStream.notify(this.metaStream, metaValue.value);
      }
    }

    this.metaStream.subscribe(this.notifyNextStream);
  }

  public disposeNow() {
    super.disposeNow();
    this.metaStream.unsubscribe(this.notifyNextStream);
    const innerStream = this.stream.get();
    if (isJust(innerStream) && isJust(innerStream.value)) {
      innerStream.value.value.unsubscribe(this.notifyNextValue);
    }
  }

  protected safeBeginTick() {
    super.safeBeginTick();
    this.stream.nextTick();
  }

  private notifyNextStream: Observer = {
    notify: (origin: CoreStream<any>, value: Maybe<any>) => {
      this.expectSender(origin, this.metaStream);
      this.listenToStream(value);
    },
    recipient: just(this)
  };

  private listenToStream(value: Maybe<CoreStream<T>>) {
    this.stream.set(value);
    if (isJust(value)) {
      this.clock.getQueue().push(() => {
        value.value.subscribe(this.notifyNextValue);
        const currentValue = value.value.getValue();
        if (isJust(currentValue)) {
          this.notifyNextValue.notify(value.value, currentValue.value);
        }
      });
    } else {
      this.value.set(nothing());
    }
  }

  private notifyNextValue: Observer = {
    notify: (origin: CoreStream<T>, value: Maybe<any>) => {
      const stream = this.stream.get();
      this.expectSenderCondition(isJust(stream) && hasValue(stream.value, origin));
      origin.unsubscribe(this.notifyNextValue);
      this.value.set(value);
    },
    recipient: just(this)
  };
}

export class SwitchStream<T> extends Stream<T> {
  private lastStream: Maybe<CoreStream<T>> = nothing();
  private nextStream: TimedMaybe<Maybe<CoreStream<T>>>;
  private running = false;

  constructor(
    clock: Clock,
    private readonly metaStream: CoreStream<CoreStream<T>>,
    keepStream?: (self: Stream<T>) => KeepStream) {

    super(clock, `${metaStream.debugString}.switch`, keepStream);

    this.nextStream = new TimedMaybe<Maybe<CoreStream<T>>>(() => {}, this.debugString);

    this.clock.register(this);
  }

  protected safeBeginTick() {
    super.safeBeginTick();

    const next = this.running ? this.nextStream.get() : nothing();
    this.running = true;

    if (isJust(this.lastStream)) {
      this.lastStream.value.unsubscribe(this.notifyNextValue);
    }

    this.lastStream = isJust(next) ? next.value : this.lastStream;

    this.nextStream.nextTick();

    if (isJust(this.lastStream)) {
      this.lastStream.value.subscribe(this.notifyNextValue);
    }
  }

  public safeOnTick() {
    super.safeOnTick();

    if (isNothing(this.lastStream)) {
      this.value.set(nothing());
    }
  }

  public notifyNextStream: Observer = {
    notify: (sender: Observable, value: Maybe<any>) => {
      this.expectSender(sender, this.metaStream);
      this.nextStream.set(value);
    },
    recipient: just(this)
  };

  public notifyNextValue: Observer = {
    notify: (sender: Observable, value: Maybe<any>) => {
      this.expectSenderCondition(hasValue(this.lastStream, sender));
      this.value.set(value);
    },
    recipient: just(this)
  };

  public initialize(state: TickState) {
    super.initialize(state);

    if (this.state === TickState.INITIALIZED || this.state === TickState.PASSIVE) {
      this.clock.getQueue().push(() => {
        const maybe = this.metaStream.getValue();
        if (isJust(maybe)) {
          this.notifyNextStream.notify(this.metaStream, maybe);
        }
        this.metaStream.subscribe(this.notifyNextStream);
      });
    } else {
      this.metaStream.subscribe(this.notifyNextStream);
    }
    if (this.state === TickState.PASSIVE) {
      if (isNothing(this.lastStream)) {
        this.value.set(nothing());
      }
    }
  }

  public disposeNow() {
    super.disposeNow();
    this.metaStream.unsubscribe(this.notifyNextStream);
    if (isJust(this.lastStream)) {
      this.lastStream.value.unsubscribe(this.notifyNextValue);
    }
  }
}

export class DropCurrentStream<T> extends Stream<T> {
  private subscriptionPending = true;

  constructor(
    clock: Clock,
    private readonly origin: CoreStream<T>,
    keepStream?: (self: Stream<T>) => KeepStream) {

    super(clock, `${origin.debugString}.dropCurrent`, keepStream);
    this.clock.register(this);
  }

  public initialize(state: TickState) {
    super.initialize(state);

    if (this.state === TickState.INITIALIZED || this.state === TickState.PASSIVE) {
      this.value.set(nothing());
    }
  }

  public disposeNow() {
    super.disposeNow();
    this.origin.unsubscribe(this.notify);
  }

  public safeBeginTick() {
    if (this.subscriptionPending) {
      this.origin.subscribe(this.notify);
    }
  }

  private notify: Observer = {
    notify: (origin: CoreStream<any>, value: Maybe<any>) => {
      this.value.set(value);
    },
    recipient: just(this)
  };
}

export class MimicStream<T> extends Stream<T> {
  private original: Maybe<CoreStream<T>> = nothing();

  constructor(clock: Clock, debugStream = "mimic", keepStream?: (self: Stream<T>) => KeepStream) {
    super(clock, debugStream, keepStream);
    this.clock.register(this);
  }

  public imitate(original: CoreStream<T>) {
    if (isNothing(this.original)) {
      this.original = just(original);
      original.subscribe(this.originalObserver);
    } else {
      throw new Error(this.debugString + " is unable to imitate more than one stream.");
    }
  }

  protected safeOnTick() {
    super.safeOnTick();

    if (isNothing(this.original)) {
      this.value.set(nothing());
    }
  }

  private originalObserver: Observer = {
    notify: (sender: Observable, value: Maybe<any>) => {
      this.expectSenderCondition(hasValue(this.original, sender));
      this.value.set(value);
    },
    recipient: just(this)
  };

  public initialize(state: TickState) {
    super.initialize(state);

    if (this.state === TickState.PASSIVE) {
      if (isNothing(this.original)) {
        this.value.set(nothing());
      }
    }
  }

  public disposeNow() {
    super.disposeNow();
    if (isJust(this.original)) {
      this.original.value.unsubscribe(this.originalObserver);
    }
  }
}

export class MarbleEngine extends TickableBase {
  private readonly sinks = new Set<Sink>();
  private readonly buffers = new Map<Sink, Map<string, any>[]>();

  public constructor(public readonly debugString = "engine") {
    super(new Clock(), debugString);
    this.clock.register(this);
  }

  public getClock() {
    return this.clock;
  }

  public nextTick(duringTick: () => void) {
    this.clock.nextTick(duringTick);
  }

  protected safeEndTick() {
    const sinksAndValues = new Map<Sink, Map<string, Maybe<any>>>();

    this.sinks.forEach(sink => {
      const values = new Map<string, Maybe<any>>();
      sink.forEach((stream, name) => {
        const value = stream.getValue();
        if (isJust(value)) {
          values.set(name, value.value);
        } /* else {
          throw new UnassignedSinkException();
        }*/
      });
      sinksAndValues.set(sink, values);
    });

    sinksAndValues.forEach((values, sink) => this.buffers.get(sink)!.push(values));
  }

  public register(tickable: Tickable) {
    this.clock.register(tickable);
  }

  public collect(sink: Sink) {
    this.sinks.add(sink);
    this.buffers.set(sink, []);
    return this.buffers.get(sink);
  }

  public merge<T>(...streams: CoreStream<T>[]): Stream<Maybe<T>[]> {
    return new MergeStream(this.clock, streams);
  }

  public mergeArray<T>(streams: CoreStream<T>[], debugString?: string): Stream<Maybe<T>[]> {
    return new MergeStream(this.clock, streams, debugString);
  }

  public mimic<T>(debugStream?: string) {
    return new MimicStream<T>(this.clock, debugStream);
  }

  public constantly<T>(value: T) {
    return this.never().fold(x => x, value, `constantly[${value}]`);
  }

  public never(debugStream?: string, keepStream?: (self: Stream<never>) => KeepStream): Stream<never> {
    return new NeverStream(this.clock, "never", keepStream);
  }

  public source<T>(debugString: string) {
    return new SourceStream<T>(this.getClock(), debugString);
  }

  public initialize(state: TickState) {
    this.state = state;
  }
}
