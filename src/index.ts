import { Maybe, Just, nothing, just, isJust, isNothing, hasValue } from "./modules/maybe";
import { UnassignedSinkException } from "./modules/exceptions";
import { Clock, TaskQueue, TimedMaybe, StreamBase, Stream, TickableBase, TickableParentBase, TickState, Sink, Tickable, Observable } from "./modules/streambase";

export * from "./modules/maybe";
export * from "./modules/streambase";

export abstract class ConvenientStreamBase<T> extends StreamBase<T> {
  constructor(protected readonly clock: Clock, debugString: string) {
    super(debugString);
  }

  public map<U>(project: (t: T) => U): ConvenientStreamBase<U> {
    return new MapStream(this.clock, this, project);
  }

  public filter(predicate: (t: T) => boolean): ConvenientStreamBase<T> {
    return new FilterStream(this.clock, this, predicate);
  }

  public mergeWith<U>(other$: Stream<U>): ConvenientStreamBase<[Maybe<T>, Maybe<U>]>;
  public mergeWith(...other$s: Stream<T>[]): ConvenientStreamBase<Maybe<T>[]>;
  public mergeWith(other$: Stream<any>): ConvenientStreamBase<Maybe<any>[]> {
    return new MergeStream<any>(this.clock, this, other$) as any;
  }

  public fold<U>(reduce: (prev: U, curr: T) => U, initialState: U): ConvenientStreamBase<U> {
    return new FoldStream(this.clock, this, reduce, initialState);
  }

  public branchFold<U>(reduce: (prev: U, curr: T) => U, initial$: Stream<U>): ConvenientStreamBase<U> {
    return new BranchFoldStream(this.clock, this, reduce, initial$);
  }

  public switch(this: ConvenientStreamBase<T & Stream<any>>): T {
    return new SwitchStream(this.clock, this) as any;
  }

  public flatten(this: ConvenientStreamBase<T & Stream<any>>): T {
    return new FlattenStream(this.clock, this) as any;
  }

  public dropCurrent(): ConvenientStreamBase<T> {
    return new DropCurrentStream(this.clock, this);
  }

  public compose<U>(fn: ($: this) => ConvenientStreamBase<U>) {
    return fn(this);
  }
}

export abstract class GlobalStreamBase<T> extends ConvenientStreamBase<T> {
  constructor(clock: Clock, debugString: string, registerEngineNow = true) {
    super(clock, debugString);
    if (registerEngineNow) {
      this.connectWithEngine();
    }
  }

  protected connectWithEngine() {
    this.clock.register(this);
  }
}

export class StrictSourceStream<T> extends GlobalStreamBase<T> {
  public setValue(value: Maybe<T>) {
    this.value.set(value);
  }

  public initialize(state: TickState) {
    this.state = state;
  }
}

export class SourceStream<T> extends GlobalStreamBase<T> {
  public setValue(value: Maybe<T>) {
    this.value.set(value);
  }

  protected safeOnTick() {
    if (isNothing(this.value.get())) {
      this.value.set(nothing());
    }
  }

  public initialize(state: TickState) {
    this.state = state;
    if (this.state === TickState.INITIALIZED || this.state === TickState.PASSIVE) {
      this.value.nextTick();
    }
    if (this.state === TickState.PASSIVE) {
      this.value.set(nothing());
    }
  }
}

export class MapStream<T, U> extends GlobalStreamBase<U> {
  constructor(
    clock: Clock,
    private readonly origin: Stream<T>,
    private readonly project: (t: T) => U) {

    super(clock, `${origin.debugString}.map`, false);
    this.connectWithEngine();
  }

  private notify = (observable: Observable, value: Maybe<any>) => {
    this.expectSender(observable, this.origin);
    this.applyProjection(value);
  }

  private applyProjection(value: Maybe<T>) {
    let result = isJust(value) ? just(this.project(value.value)) : nothing();
    this.value.set(result);
  }

  public initialize(state: TickState) {
    this.state = state;

    if (this.state === TickState.INITIALIZED || this.state === TickState.PASSIVE) {
      this.value.nextTick(); // TODO
      const originMaybe = this.origin.getValue();
      if (isJust(originMaybe)) {
        this.applyProjection(originMaybe.value);
      }
    }

    this.origin.subscribe(this.notify);
  }
}

export class FilterStream<T> extends GlobalStreamBase<T> {
  constructor(
    clock: Clock,
    private readonly origin: Stream<T>,
    private readonly predicate: (t: T) => boolean) {

    super(clock, `${origin.debugString}.filter`, false);
    this.connectWithEngine();
  }

  public initialize(state: TickState) {
    this.state = state;

    if (this.state === TickState.INITIALIZED || this.state === TickState.PASSIVE) {
      this.value.nextTick();
      const originMaybe = this.origin.getValue();
      if (isJust(originMaybe)) {
        this.notify(this.origin, originMaybe.value);
      }
    }

    this.origin.subscribe(this.notify);
  }

  private notify = (observable: Observable, value: Maybe<any>) => {
    this.expectSender(observable, this.origin);
    if (isJust(value) && this.predicate(value.value)) {
      this.value.set(just(value.value));
    } else {
      this.value.set(nothing());
    }
  }
}

export class MergeStream<T> extends GlobalStreamBase<Maybe<T>[]> {
  private readonly values: TimedMaybe<Maybe<T>>[];
  private readonly origins: Stream<T>[];

  constructor(
    clock: Clock,
    ...origins: Stream<T>[]) {

    super(clock, `merge[${origins.map(o => o.debugString)}]`, false);

    this.origins = origins;
    this.values = origins.map(o => new TimedMaybe<Maybe<T>>(this.invokeIfPossible, this.debugString));

    this.connectWithEngine();
  }

  protected safeBeginTick() {
    super.safeBeginTick();
    this.values.forEach(v => v.nextTick());
  }

  protected safeOnTick() {
    this.invokeIfPossible();
  }

  private notify = (i: number) => (sender: Observable, value: Maybe<T>) => {
    this.expectSender(sender, this.origins[i]);
    this.values[i].set(value);
  }

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
    this.state = state;

    if (state === TickState.INITIALIZED || state === TickState.PASSIVE) {
      this.value.nextTick(); // TODO: do it in TickableBase?
      this.values.forEach(v => v.nextTick());

      this.origins.forEach((o, i) => {
        const maybe = o.getValue();
        if (isJust(maybe)) {
          this.values[i].set(maybe.value);
        }
      });
      this.invokeIfPossible();
    }

    this.origins.forEach((o, i) => o.subscribe(this.notify(i)));
  }
}

export class FoldStream<T, U> extends GlobalStreamBase<U> {
  private foldState: U;

  constructor(
    clock: Clock,
    private readonly origin: Stream<T>,
    private readonly reduce: (prev: U, curr: T) => U,
    private initialValue: U) {

    super(clock, `${origin.debugString}.fold`, false);
    this.connectWithEngine();

    this.foldState = initialValue;
  }

  private notifyOrigin = (sender: Observable, curr: Maybe<T>) => {
    this.expectSender(sender, this.origin);
    if (isJust(curr)) {
      this.foldState = this.reduce(this.foldState, curr.value);
    }
    this.value.set(just(this.foldState));
  }

  public initialize(state: TickState) {
    this.state = state;

    if (this.state === TickState.INITIALIZED || this.state === TickState.PASSIVE) {
      // TODO: init this.value
      this.value.nextTick();
      this.clock.getQueue().push(() => {
        const maybe = this.origin.getValue();
        if (isJust(maybe)) {
          this.notifyOrigin(this.origin, maybe.value);
        }
        this.origin.subscribe(this.notifyOrigin);
      });
    } else {
      this.origin.subscribe(this.notifyOrigin);
    }
  }
}

export class BranchFoldStream<T, U> extends GlobalStreamBase<U> {
  private foldState: U;
  private hasInitialValue = false;
  private hasSubscribedToAction = false;

  constructor(clock: Clock, private readonly action: Stream<T>, private reduce: (prev: U, curr: T) => U, private readonly initial: Stream<U>) {
    super(clock, `${action.debugString}.branchFold[${initial.debugString}]`, false);
    this.connectWithEngine();
  }

  public initialize(state: TickState) {
    this.state = state;

    if (this.state === TickState.INITIALIZED || this.state === TickState.PASSIVE) {
      this.value.nextTick();
      this.clock.getQueue().push(() => {
        const initial = this.initial.getValue();
        if (isJust(initial)) {
          this.notifyInitial(this.initial, initial.value);
        }
      });
    }
    this.initial.subscribe(this.notifyInitial);
  }

  private notifyInitial = (sender: Stream<any>, value: Maybe<any>) => {
    this.expectSender(sender, this.initial);
    this.expectSenderCondition(!this.hasInitialValue);
    this.initial.unsubscribe(this.notifyInitial);
    if (isJust(value)) {
      this.foldState = value.value;
      this.value.set(value);
      this.hasInitialValue = true;
    } else {
      throw new Error("Initial value is Nothing");
    }
  }

  public safeBeginTick() {
    super.safeBeginTick();
    if (!this.hasSubscribedToAction && this.hasInitialValue) {
      this.hasSubscribedToAction = true;
      this.action.subscribe(this.notifyAction);
    }
  }

  private notifyAction = (sender: Stream<any>, value: Maybe<any>) => {
    this.expectSender(sender, this.action);
    this.expectSenderCondition(this.hasSubscribedToAction);
    if (isJust(value)) {
      this.foldState = this.reduce(this.foldState, value.value);
    }
    this.value.set(just(this.foldState));
  };
}

export class FlattenStream<T> extends GlobalStreamBase<T> {
  private stream: TimedMaybe<Maybe<Stream<T>>> = new TimedMaybe<Maybe<Stream<T>>>(() => {}, this.debugString);

  constructor(
    clock: Clock,
    private readonly metaStream: Stream<Stream<T>>) {

    super(clock, `${metaStream.debugString}.flatten`, false);
    this.connectWithEngine();
  }

  public initialize(state: TickState) {

    if (state === TickState.INITIALIZED || state === TickState.PASSIVE) {
      this.value.nextTick();
      this.stream.nextTick();
      const metaValue = this.metaStream.getValue();
      if (isJust(metaValue)) {
        this.notifyNextStream(this.metaStream, metaValue.value);
      }
    }

    this.metaStream.subscribe(this.notifyNextStream);
  }

  protected safeBeginTick() {
    super.safeBeginTick();
    this.stream.nextTick();
  }

  private notifyNextStream = (origin: Stream<any>, value: Maybe<any>) => {
    this.expectSender(origin, this.metaStream);
    this.listenToStream(value);
  }

  private listenToStream(value: Maybe<Stream<T>>) {
    this.stream.set(value);
    if (isJust(value)) {
      this.clock.getQueue().push(() => {
        value.value.subscribe(this.notifyNextValue);
        const currentValue = value.value.getValue();
        if (isJust(currentValue)) {
          this.notifyNextValue(value.value, currentValue.value);
        }
      });
    } else {
      this.value.set(nothing());
    }
  }

  private notifyNextValue = (origin: Stream<T>, value: Maybe<any>) => {
    const stream = this.stream.get();
    this.expectSenderCondition(isJust(stream) && hasValue(stream.value, origin));
    origin.unsubscribe(this.notifyNextValue);
    this.value.set(value);
  }
}

export class SwitchStream<T> extends GlobalStreamBase<T> {
  private lastStream: Maybe<Stream<T>> = nothing();
  private nextStream: TimedMaybe<Maybe<Stream<T>>>;
  private running = false;

  constructor(
    clock: Clock,
    private readonly metaStream: Stream<Stream<T>>) {

    super(clock, `${metaStream.debugString}.switch`);
    metaStream.subscribe(this.notifyNextStream); // TODO

    this.nextStream = new TimedMaybe<Maybe<Stream<T>>>(() => {}, this.debugString);
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

  public notifyNextStream = (sender: Observable, value: Maybe<any>) => {
    this.expectSender(sender, this.metaStream);
    this.nextStream.set(value);
  }

  public notifyNextValue = (sender: Observable, value: Maybe<any>) => {
    this.expectSenderCondition(hasValue(this.lastStream, sender));
    this.value.set(value);
  };

  public initialize(state: TickState) {
    this.state = state;

    if (this.state === TickState.INITIALIZED || this.state === TickState.PASSIVE) {
      // TODO: initialize this.value
      const maybe = this.metaStream.getValue();
      if (isJust(maybe)) {
        this.notifyNextStream(this.metaStream, maybe);
      }
    }
  }
}

export class DropCurrentStream<T> extends GlobalStreamBase<T> {
  private subscriptionPending = true;

  constructor(clock: Clock, private readonly origin: Stream<T>) {
    super(clock, `${origin.debugString}.dropCurrent`, false);
    this.connectWithEngine();
  }

  public initialize(state: TickState) {
    this.state = state;

    if (this.state === TickState.INITIALIZED || this.state === TickState.PASSIVE) {
      this.value.nextTick();
      this.value.set(nothing());
    }
  }

  public safeBeginTick() {
    if (this.subscriptionPending) {
      this.origin.subscribe(this.notify);
    }
  }

  private notify = (origin: Stream<any>, value: Maybe<any>) => {
    this.value.set(value);
  };
}

export class MimicStream<T> extends GlobalStreamBase<T> {
  private original: Maybe<Stream<T>> = nothing();

  constructor(clock: Clock) {
    super(clock, "mimic");
  }

  public imitate(original: Stream<T>) {
    if (isNothing(this.original)) {
      this.original = just(original);
      original.subscribe(this.notifyOriginal);
    } else {
      throw new Error("Unable to imitate more than one stream");
    }
  }

  protected safeOnTick() {
    super.safeOnTick();

    if (isNothing(this.original)) {
      this.value.set(nothing());
    }
  }

  private notifyOriginal = (sender: Observable, value: Maybe<any>) => {
    this.expectSenderCondition(hasValue(this.original, sender));
    this.value.set(value);
  }

  public initialize(state: TickState) {
    this.state = state;

    if (this.state === TickState.INITIALIZED || this.state === TickState.PASSIVE) {
      if (isNothing(this.original)) {
        this.value.set(nothing());
      }
    }
  }
}

export class DomSelector extends TickableBase {
  private streams = new Map<string, DomStream>();

  constructor(private readonly clock: Clock, private readonly DOMSource: any) {
    super("domSelector");
    clock.register(this);
  }

  public select(selector: string) {
    if (!this.streams.has(selector)) {
      const stream = new DomStream(selector, this.DOMSource, this.clock);
      this.clock.register(stream);
      this.streams.set(selector, stream);
    }

    return this.streams.get(selector);
  }

  public initialize(state: TickState) {
    this.state = state;
  }
}

export class DomStream extends ConvenientStreamBase<{}> {
  constructor(
    private readonly selectorString: string,
    DOMSource: any,
    clock: Clock) {

    super(clock, `dom[${selectorString}]`);

    const that = this;

    DOMSource.select(selectorString).events("click")
      .subscribe({
        next() { clock.nextTick(() => that.set({})) },
        error() {},
        complete() {},
      });
  }

  private set(value: {}) {
    this.value.set(just(value));
  }

  public safeOnTick() {
    super.safeOnTick();
    if (isNothing(this.value.get())) {
      this.value.set(nothing());
    }
  }

  public initialize(state: TickState) {
    this.state = state;
    if (state === TickState.INITIALIZED || state === TickState.PASSIVE) {
      this.value.nextTick(); // TODO: do it in TickableBase?
    }
    if (state === TickState.PASSIVE) {
      this.value.set(nothing()); // TODO
    }
  }
}

export class PortStreamSelector<T> extends TickableBase {
  private ports = new Map<string, PortStream<T>>();

  constructor(private readonly clock: Clock) {
    super("portStreamSelector");
    clock.register(this);
  }

  public select(port: string) {
    if (!this.ports.has(port)) {
      const stream = new PortStream<T>(port, this.clock);
      this.clock.register(stream);
      this.ports.set(port, stream);
    }

    return this.ports.get(port);
  }

  public initialize(state: TickState) {
    this.state = state;
  }
}

export class PortStream<T> extends ConvenientStreamBase<T> {
  constructor(
    private readonly port: string,
    clock: Clock) {

    super(clock, `port[${port}]`);
  }

  public set(value: T) {
    this.value.set(just(value));
  }

  public safeOnTick() {
    if (isNothing(this.value.get())) {
      this.value.set(nothing());
    }
  }

  public initialize(state: TickState) {
    this.state = state;
  }
}

export class MarbleEngine extends TickableBase {
  private readonly sinks = new Set<Sink>();
  private readonly buffers = new Map<Sink, Map<string, any>[]>();
  private readonly clock = new Clock();

  public constructor(public readonly debugString = "engine") {
    super(debugString);
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
      sink.streams.forEach((stream, name) => {
        const value = stream.getValue();
        if (isJust(value)) {
          values.set(name, value.value);
        } else {
          throw new UnassignedSinkException();
        }
      });
      sinksAndValues.set(sink, values);
    });

    sinksAndValues.forEach((values, sink) => this.buffers.get(sink)!.push(values));
    sinksAndValues.forEach((values, sink) => sink.notify(values));
  }

  public register(tickable: Tickable) {
    this.clock.register(tickable);
  }

  public collect(sink: Sink) {
    this.sinks.add(sink);
    this.buffers.set(sink, []);
    return this.buffers.get(sink);
  }

  public merge<T>(...streams: Stream<T>[]): ConvenientStreamBase<Maybe<T>[]> {
    return new MergeStream(this.clock, ...streams);
  }

  public mergeArray<T>(streams: Stream<T>[]): ConvenientStreamBase<Maybe<T>[]> {
    return new MergeStream(this.clock, ...streams);
  }

  public mimic<T>() {
    return new MimicStream<T>(this.clock);
  }

  public constantly<T>(value: T) {
    return this.never().fold(x => x, value);
  }

  public never(): ConvenientStreamBase<never> {
    return this.source<never>("never");
  }

  public source<T>(debugString: string) {
    return new SourceStream<T>(this.getClock(), debugString);
  }

  public initialize(state: TickState) {
    this.state = state;
  }
}
