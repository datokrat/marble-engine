(function(f){if(typeof exports==="object"&&typeof module!=="undefined"){module.exports=f()}else if(typeof define==="function"&&define.amd){define([],f)}else{var g;if(typeof window!=="undefined"){g=window}else if(typeof global!=="undefined"){g=global}else if(typeof self!=="undefined"){g=self}else{g=this}g.marbleEngine = f()}})(function(){var define,module,exports;return (function e(t,n,r){function s(o,u){if(!n[o]){if(!t[o]){var a=typeof require=="function"&&require;if(!u&&a)return a(o,!0);if(i)return i(o,!0);var f=new Error("Cannot find module '"+o+"'");throw f.code="MODULE_NOT_FOUND",f}var l=n[o]={exports:{}};t[o][0].call(l.exports,function(e){var n=t[o][1][e];return s(n?n:e)},l,l.exports,e,t,n,r)}return n[o].exports}var i=typeof require=="function"&&require;for(var o=0;o<r.length;o++)s(r[o]);return s})({1:[function(require,module,exports){
"use strict";
var __extends = (this && this.__extends) || (function () {
    var extendStatics = Object.setPrototypeOf ||
        ({ __proto__: [] } instanceof Array && function (d, b) { d.__proto__ = b; }) ||
        function (d, b) { for (var p in b) if (b.hasOwnProperty(p)) d[p] = b[p]; };
    return function (d, b) {
        extendStatics(d, b);
        function __() { this.constructor = d; }
        d.prototype = b === null ? Object.create(b) : (__.prototype = b.prototype, new __());
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
var maybe_1 = require("./modules/maybe");
var exceptions_1 = require("./modules/exceptions");
var streambase_1 = require("./modules/streambase");
var ConvenientStreamBase = (function (_super) {
    __extends(ConvenientStreamBase, _super);
    function ConvenientStreamBase(clock, debugString) {
        var _this = _super.call(this, debugString) || this;
        _this.clock = clock;
        return _this;
    }
    ConvenientStreamBase.prototype.map = function (project) {
        return new MapStream(this.clock, this, project);
    };
    ConvenientStreamBase.prototype.mergeWith = function (other$) {
        return new MergeStream(this.clock, this, other$);
    };
    ConvenientStreamBase.prototype.fold = function (reduce, initialState) {
        return new FoldStream(this.clock, this, reduce, initialState);
    };
    ConvenientStreamBase.prototype.switch = function () {
        return new SwitchStream(this.clock, this);
    };
    return ConvenientStreamBase;
}(streambase_1.StreamBase));
exports.ConvenientStreamBase = ConvenientStreamBase;
var GlobalStreamBase = (function (_super) {
    __extends(GlobalStreamBase, _super);
    function GlobalStreamBase(clock, debugString, registerEngineNow) {
        if (registerEngineNow === void 0) { registerEngineNow = true; }
        var _this = _super.call(this, clock, debugString) || this;
        if (registerEngineNow) {
            _this.connectWithEngine();
        }
        return _this;
    }
    GlobalStreamBase.prototype.connectWithEngine = function () {
        this.clock.register(this);
    };
    return GlobalStreamBase;
}(ConvenientStreamBase));
exports.GlobalStreamBase = GlobalStreamBase;
var StrictSourceStream = (function (_super) {
    __extends(StrictSourceStream, _super);
    function StrictSourceStream() {
        return _super !== null && _super.apply(this, arguments) || this;
    }
    StrictSourceStream.prototype.setValue = function (value) {
        this.value.set(value);
    };
    StrictSourceStream.prototype.initialize = function (state) {
        this.state = state;
    };
    return StrictSourceStream;
}(GlobalStreamBase));
exports.StrictSourceStream = StrictSourceStream;
var SourceStream = (function (_super) {
    __extends(SourceStream, _super);
    function SourceStream() {
        return _super !== null && _super.apply(this, arguments) || this;
    }
    SourceStream.prototype.setValue = function (value) {
        this.value.set(value);
    };
    SourceStream.prototype.safeOnTick = function () {
        if (maybe_1.isNothing(this.value.get())) {
            this.value.set(maybe_1.nothing());
        }
    };
    SourceStream.prototype.initialize = function (state) {
        this.state = state;
    };
    return SourceStream;
}(GlobalStreamBase));
exports.SourceStream = SourceStream;
var MapStream = (function (_super) {
    __extends(MapStream, _super);
    function MapStream(clock, origin, project) {
        var _this = _super.call(this, clock, origin.debugString + ".map", false) || this;
        _this.origin = origin;
        _this.project = project;
        _this.notify = function (observable, value) {
            _this.expectSender(observable, _this.origin);
            _this.applyProjection(value);
        };
        _this.connectWithEngine();
        return _this;
    }
    MapStream.prototype.applyProjection = function (value) {
        var result = maybe_1.isJust(value) ? maybe_1.just(this.project(value.value)) : maybe_1.nothing();
        this.value.set(result);
    };
    MapStream.prototype.initialize = function (state) {
        this.state = state;
        if (this.state === streambase_1.TickState.INITIALIZED || this.state === streambase_1.TickState.PASSIVE) {
            this.value.nextTick(); // TODO
            var originMaybe = this.origin.getValue();
            if (maybe_1.isJust(originMaybe)) {
                this.applyProjection(originMaybe.value);
            }
        }
        this.origin.subscribe(this.notify);
    };
    return MapStream;
}(GlobalStreamBase));
exports.MapStream = MapStream;
var MergeStream = (function (_super) {
    __extends(MergeStream, _super);
    function MergeStream(clock) {
        var origins = [];
        for (var _i = 1; _i < arguments.length; _i++) {
            origins[_i - 1] = arguments[_i];
        }
        var _this = _super.call(this, clock, "merge[" + origins.map(function (o) { return o.debugString; }) + "]", false) || this;
        _this.notify = function (i) { return function (sender, value) {
            _this.expectSender(sender, _this.origins[i]);
            _this.values[i].set(value);
        }; };
        _this.invokeIfPossible = function () {
            if (maybe_1.isJust(_this.value.get())) {
                return;
            }
            var maybes = _this.values.map(function (v) { return v.get(); });
            var wereAllSet = maybes.reduce(function (ok, maybe) { return ok && maybe_1.isJust(maybe); }, true);
            if (wereAllSet) {
                var finalValues = maybes.map(function (m) { return m.value; });
                var isNoneActive = finalValues.reduce(function (ok, maybe) { return ok && maybe_1.isNothing(maybe); }, true);
                var value = isNoneActive
                    ? maybe_1.nothing()
                    : maybe_1.just(finalValues);
                _this.value.set(value);
            }
        };
        _this.origins = origins;
        _this.values = origins.map(function (o) { return new streambase_1.TimedMaybe(_this.invokeIfPossible, _this.debugString); });
        _this.connectWithEngine();
        return _this;
    }
    MergeStream.prototype.safeBeginTick = function () {
        _super.prototype.safeBeginTick.call(this);
        this.values.forEach(function (v) { return v.nextTick(); });
        this.invokeIfPossible();
    };
    MergeStream.prototype.initialize = function (state) {
        var _this = this;
        this.state = state;
        if (state === streambase_1.TickState.INITIALIZED || state === streambase_1.TickState.PASSIVE) {
            this.value.nextTick(); // TODO: do it in TickableBase?
            this.values.forEach(function (v) { return v.nextTick(); });
            this.origins.forEach(function (o, i) {
                var maybe = o.getValue();
                if (maybe_1.isJust(maybe)) {
                    _this.values[i].set(maybe.value);
                }
            });
            this.invokeIfPossible();
        }
        this.origins.forEach(function (o, i) { return o.subscribe(_this.notify(i)); });
    };
    return MergeStream;
}(GlobalStreamBase));
exports.MergeStream = MergeStream;
var FoldStream = (function (_super) {
    __extends(FoldStream, _super);
    function FoldStream(clock, origin, reduce, initialValue) {
        var _this = _super.call(this, clock, origin.debugString + ".fold", false) || this;
        _this.origin = origin;
        _this.reduce = reduce;
        _this.initialValue = initialValue;
        _this.notifyOrigin = function (sender, curr) {
            _this.expectSender(sender, _this.origin);
            if (maybe_1.isJust(curr)) {
                _this.foldState = _this.reduce(_this.foldState, curr.value);
            }
            _this.value.set(maybe_1.just(_this.foldState));
        };
        _this.connectWithEngine();
        _this.origin.subscribe(_this.notifyOrigin);
        _this.foldState = initialValue;
        return _this;
    }
    FoldStream.prototype.initialize = function (state) {
        this.state = state;
        if (this.state === streambase_1.TickState.INITIALIZED || this.state === streambase_1.TickState.PASSIVE) {
            var maybe = this.origin.getValue();
            if (maybe_1.isJust(maybe)) {
                this.notifyOrigin(this.origin, maybe.value);
            }
        }
    };
    return FoldStream;
}(GlobalStreamBase));
exports.FoldStream = FoldStream;
var SwitchStream = (function (_super) {
    __extends(SwitchStream, _super);
    function SwitchStream(clock, metaStream) {
        var _this = _super.call(this, clock, metaStream.debugString + ".switch", false) || this;
        _this.metaStream = metaStream;
        _this.lastStream = maybe_1.nothing();
        _this.running = false;
        _this.notifyNextStream = function (sender, value) {
            _this.expectSender(sender, _this.metaStream);
            _this.nextStream.set(value);
        };
        _this.notifyNextValue = function (sender, value) {
            _this.expectSenderCondition(maybe_1.hasValue(_this.lastStream, sender));
            _this.value.set(value);
        };
        _this.connectWithEngine();
        metaStream.subscribe(_this.notifyNextStream);
        _this.nextStream = new streambase_1.TimedMaybe(function () { }, _this.debugString);
        return _this;
    }
    SwitchStream.prototype.safeBeginTick = function () {
        _super.prototype.safeBeginTick.call(this);
        var next = this.running ? this.nextStream.get() : maybe_1.nothing();
        this.running = true;
        if (maybe_1.isJust(this.lastStream)) {
            this.lastStream.value.unsubscribe(this.notifyNextValue);
        }
        this.lastStream = maybe_1.isJust(next) ? next.value : this.lastStream;
        this.nextStream.nextTick();
        if (maybe_1.isJust(this.lastStream)) {
            this.lastStream.value.subscribe(this.notifyNextValue);
        }
    };
    SwitchStream.prototype.safeOnTick = function () {
        _super.prototype.safeOnTick.call(this);
        if (maybe_1.isNothing(this.lastStream)) {
            this.value.set(maybe_1.nothing());
        }
    };
    SwitchStream.prototype.initialize = function (state) {
        this.state = state;
        if (this.state === streambase_1.TickState.INITIALIZED || this.state === streambase_1.TickState.PASSIVE) {
            var maybe = this.metaStream.getValue();
            if (maybe_1.isJust(maybe)) {
                this.notifyNextStream(this.metaStream, maybe);
            }
        }
    };
    return SwitchStream;
}(GlobalStreamBase));
exports.SwitchStream = SwitchStream;
var MimicStream = (function (_super) {
    __extends(MimicStream, _super);
    function MimicStream(clock) {
        var _this = _super.call(this, clock, "mimic") || this;
        _this.original = maybe_1.nothing();
        _this.notifyOriginal = function (sender, value) {
            _this.expectSenderCondition(maybe_1.hasValue(_this.original, sender));
            _this.value.set(value);
        };
        return _this;
    }
    MimicStream.prototype.imitate = function (original) {
        if (maybe_1.isNothing(this.original)) {
            this.original = maybe_1.just(original);
            original.subscribe(this.notifyOriginal);
        }
        else {
            throw new Error("Unable to imitate more than one stream");
        }
    };
    MimicStream.prototype.safeOnTick = function () {
        _super.prototype.safeOnTick.call(this);
        if (maybe_1.isNothing(this.original)) {
            this.value.set(maybe_1.nothing());
        }
    };
    MimicStream.prototype.initialize = function (state) {
        this.state = state;
        if (this.state === streambase_1.TickState.INITIALIZED || this.state === streambase_1.TickState.PASSIVE) {
            if (maybe_1.isNothing(this.original)) {
                this.value.set(maybe_1.nothing());
            }
        }
    };
    return MimicStream;
}(GlobalStreamBase));
exports.MimicStream = MimicStream;
var DomSelector = (function (_super) {
    __extends(DomSelector, _super);
    function DomSelector(clock, DOMSource) {
        var _this = _super.call(this, "domSelector") || this;
        _this.clock = clock;
        _this.DOMSource = DOMSource;
        _this.streams = new Map();
        clock.register(_this);
        return _this;
    }
    DomSelector.prototype.select = function (selector) {
        if (!this.streams.has(selector)) {
            var stream = new DomStream(selector, this.DOMSource, this.clock);
            this.clock.register(stream);
            this.streams.set(selector, stream);
        }
        return this.streams.get(selector);
    };
    DomSelector.prototype.initialize = function (state) {
        this.state = state;
    };
    return DomSelector;
}(streambase_1.TickableBase));
exports.DomSelector = DomSelector;
var DomStream = (function (_super) {
    __extends(DomStream, _super);
    function DomStream(selectorString, DOMSource, clock) {
        var _this = _super.call(this, clock, "dom[" + selectorString + "]") || this;
        _this.selectorString = selectorString;
        var that = _this;
        DOMSource.select(selectorString).events("click")
            .subscribe({
            next: function () { clock.nextTick(function () { return that.set({}); }); },
            error: function () { },
            complete: function () { },
        });
        return _this;
    }
    DomStream.prototype.set = function (value) {
        this.value.set(maybe_1.just(value));
    };
    DomStream.prototype.safeOnTick = function () {
        _super.prototype.safeOnTick.call(this);
        if (maybe_1.isNothing(this.value.get())) {
            this.value.set(maybe_1.nothing());
        }
    };
    DomStream.prototype.initialize = function (state) {
        this.state = state;
        if (state === streambase_1.TickState.INITIALIZED || state === streambase_1.TickState.PASSIVE) {
            this.value.nextTick(); // TODO: do it in TickableBase?
        }
        if (state === streambase_1.TickState.PASSIVE) {
            this.value.set(maybe_1.nothing()); // TODO
        }
    };
    return DomStream;
}(ConvenientStreamBase));
exports.DomStream = DomStream;
var PortStreamSelector = (function (_super) {
    __extends(PortStreamSelector, _super);
    function PortStreamSelector(clock) {
        var _this = _super.call(this, "portStreamSelector") || this;
        _this.clock = clock;
        _this.ports = new Map();
        clock.register(_this);
        return _this;
    }
    PortStreamSelector.prototype.select = function (port) {
        if (!this.ports.has(port)) {
            var stream = new PortStream(port, this.clock);
            this.clock.register(stream);
            this.ports.set(port, stream);
        }
        return this.ports.get(port);
    };
    PortStreamSelector.prototype.initialize = function (state) {
        this.state = state;
    };
    return PortStreamSelector;
}(streambase_1.TickableBase));
exports.PortStreamSelector = PortStreamSelector;
var PortStream = (function (_super) {
    __extends(PortStream, _super);
    function PortStream(port, clock) {
        var _this = _super.call(this, clock, "port[" + port + "]") || this;
        _this.port = port;
        return _this;
    }
    PortStream.prototype.set = function (value) {
        this.value.set(maybe_1.just(value));
    };
    PortStream.prototype.safeOnTick = function () {
        if (maybe_1.isNothing(this.value.get())) {
            this.value.set(maybe_1.nothing());
        }
    };
    PortStream.prototype.initialize = function (state) {
        this.state = state;
    };
    return PortStream;
}(ConvenientStreamBase));
exports.PortStream = PortStream;
var MarbleEngine = (function (_super) {
    __extends(MarbleEngine, _super);
    function MarbleEngine(debugString) {
        if (debugString === void 0) { debugString = "engine"; }
        var _this = _super.call(this, debugString) || this;
        _this.debugString = debugString;
        _this.sinks = new Set();
        _this.buffers = new Map();
        _this.clock = new streambase_1.Clock();
        _this.clock.register(_this);
        return _this;
    }
    MarbleEngine.prototype.getClock = function () {
        return this.clock;
    };
    MarbleEngine.prototype.nextTick = function (duringTick) {
        this.clock.nextTick(duringTick);
    };
    MarbleEngine.prototype.safeEndTick = function () {
        var _this = this;
        var sinksAndValues = new Map();
        this.sinks.forEach(function (sink) {
            var values = new Map();
            sink.streams.forEach(function (stream, name) {
                var value = stream.getValue();
                if (maybe_1.isJust(value)) {
                    values.set(name, value.value);
                }
                else {
                    throw new exceptions_1.UnassignedSinkException();
                }
            });
            sinksAndValues.set(sink, values);
        });
        sinksAndValues.forEach(function (values, sink) { return _this.buffers.get(sink).push(values); });
        sinksAndValues.forEach(function (values, sink) { return sink.notify(values); });
    };
    MarbleEngine.prototype.register = function (tickable) {
        this.clock.register(tickable);
    };
    MarbleEngine.prototype.collect = function (sink) {
        this.sinks.add(sink);
        this.buffers.set(sink, []);
        return this.buffers.get(sink);
    };
    MarbleEngine.prototype.merge = function () {
        var streams = [];
        for (var _i = 0; _i < arguments.length; _i++) {
            streams[_i] = arguments[_i];
        }
        return new (MergeStream.bind.apply(MergeStream, [void 0, this.clock].concat(streams)))();
    };
    MarbleEngine.prototype.mimic = function () {
        return new MimicStream(this.clock);
    };
    MarbleEngine.prototype.initialize = function (state) {
        this.state = state;
    };
    return MarbleEngine;
}(streambase_1.TickableBase));
exports.MarbleEngine = MarbleEngine;

},{"./modules/exceptions":2,"./modules/maybe":3,"./modules/streambase":4}],2:[function(require,module,exports){
"use strict";
var __extends = (this && this.__extends) || (function () {
    var extendStatics = Object.setPrototypeOf ||
        ({ __proto__: [] } instanceof Array && function (d, b) { d.__proto__ = b; }) ||
        function (d, b) { for (var p in b) if (b.hasOwnProperty(p)) d[p] = b[p]; };
    return function (d, b) {
        extendStatics(d, b);
        function __() { this.constructor = d; }
        d.prototype = b === null ? Object.create(b) : (__.prototype = b.prototype, new __());
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
var Exception = (function (_super) {
    __extends(Exception, _super);
    function Exception(message) {
        var _newTarget = this.constructor;
        var _this = _super.call(this, message) || this;
        Object.setPrototypeOf(_this, _newTarget.prototype);
        return _this;
    }
    return Exception;
}(Error));
exports.Exception = Exception;
var UnassignedSinkException = (function (_super) {
    __extends(UnassignedSinkException, _super);
    function UnassignedSinkException() {
        return _super.call(this, "Sink was not assigned during the current tick.") || this;
    }
    return UnassignedSinkException;
}(Exception));
exports.UnassignedSinkException = UnassignedSinkException;
var TimingException = (function (_super) {
    __extends(TimingException, _super);
    function TimingException(message) {
        return _super.call(this, "Ticks are not synchronized among tickables. " + message) || this;
    }
    return TimingException;
}(Exception));
exports.TimingException = TimingException;
var MultipleAssignmentsException = (function (_super) {
    __extends(MultipleAssignmentsException, _super);
    function MultipleAssignmentsException(message) {
        return _super.call(this, "Multiple values were assigned to a stream. " + message) || this;
    }
    return MultipleAssignmentsException;
}(Exception));
exports.MultipleAssignmentsException = MultipleAssignmentsException;
var UnexpectedNotificationException = (function (_super) {
    __extends(UnexpectedNotificationException, _super);
    function UnexpectedNotificationException() {
        return _super.call(this, "A notification was sent from a stream that is not listened to.") || this;
    }
    return UnexpectedNotificationException;
}(Exception));
exports.UnexpectedNotificationException = UnexpectedNotificationException;

},{}],3:[function(require,module,exports){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
function nothing() { return { type: "nothing", toString: nothingToString }; }
exports.nothing = nothing;
function just(value) { return { type: "just", value: value, toString: justToString }; }
exports.just = just;
;
function isJust(m) { return m.type === "just"; }
exports.isJust = isJust;
function hasValue(m, t) { return isJust(m) && m.value === t; }
exports.hasValue = hasValue;
function hasMatchingValue(m, predicate) { return isJust(m) && predicate(m.value); }
exports.hasMatchingValue = hasMatchingValue;
function valueOrUndefined(m) { return isJust(m) ? m.value : undefined; }
exports.valueOrUndefined = valueOrUndefined;
function isNothing(m) { return m.type === "nothing"; }
exports.isNothing = isNothing;
function maybe() { return nothing(); }
exports.maybe = maybe;
function justToString() {
    return this.value.toString();
}
function nothingToString() {
    return "nothing";
}

},{}],4:[function(require,module,exports){
"use strict";
var __extends = (this && this.__extends) || (function () {
    var extendStatics = Object.setPrototypeOf ||
        ({ __proto__: [] } instanceof Array && function (d, b) { d.__proto__ = b; }) ||
        function (d, b) { for (var p in b) if (b.hasOwnProperty(p)) d[p] = b[p]; };
    return function (d, b) {
        extendStatics(d, b);
        function __() { this.constructor = d; }
        d.prototype = b === null ? Object.create(b) : (__.prototype = b.prototype, new __());
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
var maybe_1 = require("./maybe");
var exceptions_1 = require("./exceptions");
var Clock = (function () {
    function Clock() {
        this.queue = new TaskQueue();
        this.tickables = new Set();
        this.state = TickState.IDLE;
    }
    Clock.prototype.getQueue = function () {
        return this.queue;
    };
    Clock.prototype.register = function (tickable) {
        var _this = this;
        this.queue.push(function () {
            if (!_this.tickables.has(tickable)) {
                _this.tickables.add(tickable);
                tickable.initialize(_this.state);
            }
        });
    };
    Clock.prototype.nextTick = function (duringTick) {
        this.beginTick();
        this.duringTick(duringTick);
        this.onTick();
        this.endTick();
    };
    Clock.prototype.beginTick = function () {
        this.state = TickState.INITIALIZED;
        this.propagate(function (tickable) { return tickable.beginTick(); });
    };
    Clock.prototype.duringTick = function (duringTick) {
        this.queue.push(duringTick);
    };
    Clock.prototype.onTick = function () {
        this.state = TickState.PASSIVE;
        this.propagate(function (tickable) { return tickable.onTick(); });
    };
    Clock.prototype.endTick = function () {
        this.state = TickState.IDLE;
        this.propagate(function (tickable) { return tickable.endTick(); });
    };
    Clock.prototype.propagate = function (task) {
        var _this = this;
        this.queue.push(function () {
            _this.tickables.forEach(task);
        });
    };
    return Clock;
}());
exports.Clock = Clock;
var TaskQueue = (function () {
    function TaskQueue() {
        this.tasks = [];
        this.running = false;
    }
    TaskQueue.prototype.push = function (task) {
        this.tasks.push(task);
        this.runAll();
    };
    TaskQueue.prototype.isEmpty = function () {
        return this.tasks.length <= 0;
    };
    TaskQueue.prototype.pop = function () {
        if (!this.isEmpty()) {
            var task = this.tasks[0];
            this.tasks.splice(0, 1);
            return task;
        }
        else {
            throw new Error("Cannot pop from empty TaskQueue");
        }
    };
    TaskQueue.prototype.runAll = function () {
        if (!this.running) {
            this.running = true;
            while (!this.isEmpty()) {
                this.pop()();
            }
            this.running = false;
        }
    };
    return TaskQueue;
}());
exports.TaskQueue = TaskQueue;
var TickState;
(function (TickState) {
    TickState[TickState["IDLE"] = 0] = "IDLE";
    TickState[TickState["INITIALIZED"] = 1] = "INITIALIZED";
    TickState[TickState["PASSIVE"] = 2] = "PASSIVE";
})(TickState = exports.TickState || (exports.TickState = {}));
var TickableBase = (function () {
    function TickableBase(debugString) {
        if (debugString === void 0) { debugString = "tickable"; }
        this.debugString = debugString;
        this.state = TickState.IDLE;
        this.propagating = false;
    }
    TickableBase.prototype.beginTick = function () {
        if (!this.propagating && this.state === TickState.IDLE) {
            this.state = TickState.INITIALIZED;
            this.propagating = true;
            this.safeBeginTick();
            this.propagating = false;
        }
        else {
            throw new exceptions_1.TimingException(this.debugString);
        }
    };
    TickableBase.prototype.onTick = function () {
        if (!this.propagating && this.state === TickState.INITIALIZED) {
            this.state = TickState.PASSIVE;
            this.propagating = true;
            this.safeOnTick();
            this.propagating = false;
        }
        else {
            throw new exceptions_1.TimingException(this.debugString);
        }
    };
    TickableBase.prototype.endTick = function () {
        if (!this.propagating && this.state === TickState.PASSIVE) {
            this.state = TickState.IDLE;
            this.propagating = true;
            this.safeEndTick();
            this.propagating = false;
        }
        else {
            throw new exceptions_1.TimingException(this.debugString);
        }
    };
    TickableBase.prototype.safeBeginTick = function () { };
    TickableBase.prototype.safeOnTick = function () { };
    TickableBase.prototype.safeEndTick = function () { };
    return TickableBase;
}());
exports.TickableBase = TickableBase;
var TickableParentBase = (function (_super) {
    __extends(TickableParentBase, _super);
    function TickableParentBase(clock, debugString) {
        var _this = _super.call(this, debugString) || this;
        _this.clock = clock;
        _this.tickables = new Set();
        return _this;
    }
    TickableParentBase.prototype.addTickable = function (tickable) {
        var _this = this;
        this.clock.getQueue().push(function () {
            if (!_this.tickables.has(tickable)) {
                _this.tickables.add(tickable);
                _this.initializeChild(tickable);
            }
        });
    };
    TickableParentBase.prototype.safeBeginTick = function () {
        this.tickables.forEach(function (tickable) { return tickable.beginTick(); });
    };
    TickableParentBase.prototype.safeOnTick = function () {
        this.tickables.forEach(function (tickable) { return tickable.onTick(); });
    };
    TickableParentBase.prototype.safeEndTick = function () {
        this.tickables.forEach(function (tickable) { return tickable.endTick(); });
    };
    TickableParentBase.prototype.initializeChild = function (tickable) {
        tickable.initialize(this.state);
    };
    TickableParentBase.prototype.initialize = function (state) {
        this.state = state;
        this.tickables.forEach(function (t) { return t.initialize(state); });
    };
    return TickableParentBase;
}(TickableBase));
exports.TickableParentBase = TickableParentBase;
var TimedMaybe = (function () {
    function TimedMaybe(notify, debugString) {
        this.notify = notify;
        this.debugString = debugString;
        this.running = false;
        this.propagating = false;
        this.value = maybe_1.nothing();
    }
    TimedMaybe.prototype.nextTick = function () {
        if (maybe_1.isJust(this.value) || !this.running) {
            this.running = true;
            this.value = maybe_1.nothing();
        }
        else {
            throw new Error("TimedMaybe expected a value for the completed tick. " + this.debugString);
        }
    };
    TimedMaybe.prototype.set = function (value) {
        if (this.running) {
            if (maybe_1.isNothing(this.value)) {
                this.value = maybe_1.just(value);
                this.propagating = true;
                this.notify(value);
                this.propagating = false;
            }
            else {
                throw new exceptions_1.MultipleAssignmentsException();
            }
        }
        else {
            throw new Error("TimedMaybe was not initialized.");
        }
    };
    TimedMaybe.prototype.get = function () {
        if (this.running) {
            return this.value;
        }
        else {
            throw new Error("TimedMaybe was not initialized.");
        }
    };
    return TimedMaybe;
}());
exports.TimedMaybe = TimedMaybe;
var StreamBase = (function (_super) {
    __extends(StreamBase, _super);
    function StreamBase(debugString) {
        var _this = _super.call(this, debugString) || this;
        _this.observers = new Set();
        _this.value = new TimedMaybe(function (value) {
            return _this.observers.forEach(function (notify) { return notify(_this, value); });
        }, debugString + "'");
        return _this;
    }
    StreamBase.prototype.safeBeginTick = function () {
        _super.prototype.safeBeginTick.call(this);
        this.value.nextTick();
    };
    StreamBase.prototype.getValue = function () {
        return this.value.get();
    };
    StreamBase.prototype.subscribe = function (observer) {
        this.observers.add(observer);
    };
    StreamBase.prototype.unsubscribe = function (observer) {
        this.observers.delete(observer);
    };
    StreamBase.prototype.expectSender = function (actual, expected) {
        this.expectSenderCondition(actual === expected);
    };
    StreamBase.prototype.expectSenderCondition = function (condition) {
        if (!condition) {
            throw new exceptions_1.UnexpectedNotificationException();
        }
    };
    return StreamBase;
}(TickableBase));
exports.StreamBase = StreamBase;

},{"./exceptions":2,"./maybe":3}]},{},[1])(1)
});