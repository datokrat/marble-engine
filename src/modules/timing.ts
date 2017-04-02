import {TimingException, MultipleAssignmentsException} from "./exceptions";
import {Maybe, just, nothing, isJust, isNothing} from "./maybe";
import {log} from "./logger";

export interface Tickable {
  beginTick(): void;
  onTick(): void;
  endTick(): void;
  initialize(state: TickState): void;
}

export enum TickState {
  IDLE = 0,
  INITIALIZED = 1,
  PASSIVE = 2,
}

export enum DisposedState { DISPOSED = 3 }

export type TickableState = TickState | DisposedState;

export function isDisposed(state: TickableState): state is DisposedState {
  return state === DisposedState.DISPOSED;
}

export interface DisposalObservable {
  subscribeDisposal(observer: DisposalObserver);
  unsubscribeDisposal(observer: DisposalObserver);
}

export type DisposalObserver = (sender: DisposalObservable) => void;

export abstract class TickableBase implements Tickable, DisposalObservable {
  protected state: TickableState = TickState.IDLE;
  private propagating = false;
  private isToBeDisposed = false;
  private readonly disposalObservers = new Set<DisposalObserver>();

  constructor(
    protected readonly clock: Clock,
    public readonly debugString = "tickable") {}

  public beginTick() {
    if (this.propagating) throw new TimingException(this.debugString);
    else if (this.isToBeDisposed) {
      this.clock.getQueue().push(() => this.disposeNow());
    }
    else if (this.state === TickState.IDLE) {
      this.state = TickState.INITIALIZED;
      this.propagating = true;
      this.safeBeginTick();
      this.propagating = false;
    } else {
      throw new TimingException(this.debugString);
    }
  }

  public onTick() {
    if (!this.propagating && this.state === TickState.INITIALIZED) {
      this.state = TickState.PASSIVE;
      this.propagating = true;
      this.safeOnTick();
      this.propagating = false;
    } else {
      throw new TimingException(this.debugString);
    }
  }

  public endTick() {
    if (!this.propagating && this.state === TickState.PASSIVE) {
      this.state = TickState.IDLE;
      this.propagating = true;
      this.safeEndTick();
      this.propagating = false;
    } else {
      throw new TimingException(this.debugString);
    }
  }

  protected scheduleDisposal() {
    log("scheduleDisposal", this.debugString);
    if (this.clock.isInitializing()) {
      this.disposeNow();
    } else {
      this.isToBeDisposed = true;
    }
    this.disposalObservers.forEach(observer => observer(this));
  }

  public subscribeDisposal(observer: DisposalObserver) {
    if (!this.disposalObservers.has(observer)) {
      this.disposalObservers.add(observer);
      if (this.state === DisposedState.DISPOSED) {
        observer(this);
      }
    }
  }

  public unsubscribeDisposal(observer: DisposalObserver) {
    this.disposalObservers.delete(observer);
  }

  protected disposeNow() {
    this.state = DisposedState.DISPOSED;
    this.disposalObservers.clear();
  }

  protected safeBeginTick(): void {}
  protected safeOnTick(): void {}
  protected safeEndTick(): void {}
  public abstract initialize(state: TickState): void;
}

export class Clock {
  private readonly queue = new TaskQueue();
  private readonly tickables = new Set<Tickable>();
  private initializing = false;
  private state = TickState.IDLE;

  public getQueue() {
    return this.queue;
  }

  public register(tickable: Tickable) {
    this.queue.push(() => {
      if (!this.tickables.has(tickable)) {
        this.tickables.add(tickable);
        tickable.initialize(this.state);
      }
    });
  }

  public unregister(tickable: Tickable) {
    this.tickables.delete(tickable);
  }

  public getRegistered() {
    const arr: Tickable[] = [];
    this.tickables.forEach(it => arr.push(it));
    return arr;
  }

  public nextTick(duringTick: () => void) {
    log("=== beginTick ===");
    this.beginTick();
    log("=== duringTick ===");
    this.duringTick(duringTick);
    log("=== onTick ===");
    this.onTick();
    log("=== endTick ===");
    this.endTick();
    log("=== finished ===");
  }

  public isInitializing() {
    return this.initializing;
  }

  private beginTick() {
    this.state = TickState.INITIALIZED;
    this.initializing = true;
    this.propagate(tickable => tickable.beginTick());
    this.initializing = false;
  }

  private duringTick(duringTick: () => void) {
    this.queue.push(duringTick);
  }

  private onTick() {
    this.state = TickState.PASSIVE;
    this.propagate(tickable => tickable.onTick());
  }

  private endTick() {
    this.state = TickState.IDLE;
    this.propagate(tickable => tickable.endTick());
  }

  private propagate(task: (tickable: Tickable) => void) {
    this.queue.push(() => {
      this.tickables.forEach(task);
    });
  }
}

export class TaskQueue {
  private readonly tasks: (() => void)[] = [];
  private running = false;

  public push(task: () => void): void {
    this.tasks.push(task);
    this.runAll();
  }

  private isEmpty(): boolean {
    return this.tasks.length <= 0;
  }

  private pop(): () => void {
    if (!this.isEmpty()) {
      const task = this.tasks[0];
      this.tasks.splice(0, 1);
      return task;
    } else {
      throw new Error("Cannot pop from empty TaskQueue");
    }
  }

  private runAll(): void {
    if (!this.running) {
      this.running = true;
      while (!this.isEmpty()) {
        this.pop()();
      }
      this.running = false;
    }
  }
}

export class TimedMaybe<T> {
  private running = false;
  private propagating = false;
  private disposed = false;
  private value: Maybe<T> = nothing();

  constructor(private notify: (value: T) => void, private readonly debugString: string) {}

  public nextTick() {
    if (isJust(this.value) || !this.running) {
      this.running = true;
      this.value = nothing();
    } else {
      throw new Error("TimedMaybe expected a value for the completed tick. " + this.debugString);
    }
  }

  public set(value: T) {
    if (this.running && !this.disposed) {
      if (isNothing(this.value)) {
        this.value = just(value);
        this.propagating = true;
        this.notify(value);
        this.propagating = false;
      } else {
        throw new MultipleAssignmentsException(this.debugString);
      }
    } else {
      throw new Error("TimedMaybe was not initialized or has been disposed (set). " + this.debugString);
    }
  }

  public get() {
    if (this.running) {
      return this.value;
    } else {
      throw new Error("TimedMaybe was not initialized (get). " + this.debugString);
    }
  }

  public dispose() {
    this.disposed = true;
    this.value = nothing();
  }
}
