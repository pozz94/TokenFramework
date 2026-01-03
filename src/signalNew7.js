import { wrapInContext } from './utils.js';

// ============================================================================
// CORE STATE
// ============================================================================

const SIGNAL_MARK = Symbol();
let currentEffect = null;
let pendingEffects = new Set();
let isFlushing = false;
let updateDepth = 0;
let flushCount = 0;
const MAX_DEPTH = 100;
const MAX_FLUSH = 100;

// ============================================================================
// SIGNAL - Flat implementation without proxy overhead
// ============================================================================

function signal(initialValue) {
	const subscribers = new Set();
	const propertySignals = new Map();
	let value = initialValue;
	let onFirstSub = null;
	let onLastUnsubscribed = null;
	let signalArray = null;

	const sig = {
		[SIGNAL_MARK]: true,

		// Core value accessor
		get v() {
			// Subscribe current effect
			if (currentEffect && !subscribers.has(currentEffect)) {
				if (subscribers.size === 0 && onFirstSub) onFirstSub();
				subscribers.add(currentEffect);
				currentEffect.dependenciesCleanups.add(() => {
					subscribers.delete(currentEffect);
					if (subscribers.size === 0 && onLastUnsubscribed) onLastUnsubscribed();
				});
				currentEffect.dependencies.add(sig);
			}
			return value;
		},

		set v(newValue) {
			if (value === newValue) return;
			value = newValue;
			queueEffects(subscribers);
		},

		// Lifecycle hooks
		onFirstSubscriber(cb) {
			onFirstSub = cb;
			if (subscribers.size > 0 && onFirstSub) onFirstSub();
			return sig;
		},

		onLastSubscriberRemoved(cb) {
			onLastUnsubscribed = cb;
			return sig;
		},

		// Array handling
		push(...items) {
			if (!Array.isArray(value)) throw new Error('push() requires array');
			const newArray = [...value, ...items];
			sig.v = newArray;
			return newArray.length;
		},

		pop() {
			if (!Array.isArray(value)) throw new Error('pop() requires array');
			if (value.length === 0) return undefined;
			const newArray = value.slice(0, -1);
			const popped = value[value.length - 1];
			sig.v = newArray;
			return popped;
		},

		shift() {
			if (!Array.isArray(value)) throw new Error('shift() requires array');
			if (value.length === 0) return undefined;
			const shifted = value[0];
			sig.v = value.slice(1);
			return shifted;
		},

		unshift(...items) {
			if (!Array.isArray(value)) throw new Error('unshift() requires array');
			const newArray = [...items, ...value];
			sig.v = newArray;
			return newArray.length;
		},

		splice(start, deleteCount, ...items) {
			if (!Array.isArray(value)) throw new Error('splice() requires array');
			const newArray = [...value];
			const result = newArray.splice(start, deleteCount, ...items);
			sig.v = newArray;
			return result;
		},

		sort(compareFn) {
			if (!Array.isArray(value)) throw new Error('sort() requires array');
			const newArray = [...value];
			newArray.sort(compareFn);
			sig.v = newArray;
			return sig;
		},

		reverse() {
			if (!Array.isArray(value)) throw new Error('reverse() requires array');
			sig.v = [...value].reverse();
			return sig;
		},

		// Non-mutating array methods
		map(fn) {
			if (!Array.isArray(value)) return undefined;
			const arr = getSignalArray();
			return arr.map(fn);
		},

		filter(fn) {
			if (!Array.isArray(value)) return undefined;
			const arr = getSignalArray();
			return arr.filter(fn);
		},

		reduce(fn, initial) {
			if (!Array.isArray(value)) return undefined;
			const arr = getSignalArray();
			return arr.reduce(fn, initial);
		},

		forEach(fn) {
			if (!Array.isArray(value)) return;
			const arr = getSignalArray();
			arr.forEach(fn);
		},

		find(fn) {
			if (!Array.isArray(value)) return undefined;
			const arr = getSignalArray();
			return arr.find(fn);
		},

		some(fn) {
			if (!Array.isArray(value)) return false;
			const arr = getSignalArray();
			return arr.some(fn);
		},

		every(fn) {
			if (!Array.isArray(value)) return false;
			const arr = getSignalArray();
			return arr.every(fn);
		},

		// Array accessors
		at(index) {
			if (!Array.isArray(value)) return undefined;
			const arr = getSignalArray();
			return arr[index];
		},

		get length() {
			return Array.isArray(value) ? value.length : undefined;
		},

		// Property access
		prop(name) {
			if (propertySignals.has(name)) return propertySignals.get(name);

			const propSig = computed(
				() => value?.[name],
				(newVal) => {
					if (Array.isArray(value)) {
						const arr = [...value];
						arr[name] = newVal;
						sig.v = arr;
					} else if (value && typeof value === 'object') {
						const newObj = { ...value, [name]: newVal };
						sig.v = newObj;
					} else {
						sig.v = { [name]: newVal };
					}
				}
			);

			propSig.onLastSubscriberRemoved(() => propertySignals.delete(name));
			propertySignals.set(name, propSig);
			return propSig;
		},

		// Timing modifiers
		debounce(delay) {
			return debounce(sig, delay);
		},

		throttle(delay) {
			return throttle(sig, delay);
		},

		// Internal
		_getValue: () => value,
		_getSubscribers: () => subscribers,
		_notify: () => queueEffects(subscribers)
	};

	// Helper for signal array
	function getSignalArray() {
		if (!Array.isArray(value)) return null;

		if (!signalArray) signalArray = [];

		const len = value.length;
		while (signalArray.length < len) {
			const idx = signalArray.length;
			signalArray.push(sig.prop(idx));
		}
		if (signalArray.length > len) {
			signalArray.length = len;
		}

		return signalArray;
	}

	// Support indexed access
	return new Proxy(sig, {
		get(target, prop) {
			if (prop in target) return target[prop];

			// Numeric index for arrays
			if (Array.isArray(value)) {
				const idx = Number(prop);
				if (Number.isInteger(idx) && idx >= 0) {
					const arr = getSignalArray();
					return arr?.[idx];
				}
			}

			// Property access
			if (typeof prop === 'string') {
				return target.prop(prop);
			}

			return target[prop];
		},

		set(target, prop, val) {
			if (prop === 'v') {
				target.v = val;
				return true;
			}

			// Set through property signal
			const propSig = target.prop(prop);
			propSig.v = val;
			return true;
		}
	});
}

// ============================================================================
// COMPUTED - Flat implementation
// ============================================================================

function computed(getFn, setFn) {
	if (isSignal(getFn)) return getFn;

	// Async detection
	if (getFn.constructor.name === 'AsyncFunction') {
		return computed.async(getFn, setFn);
	}

	const sig = signal(undefined);
	let cleanup = null;
	let sourceSignal = null;

	const init = () => {
		if (cleanup) return;
		cleanup = effect(() => {
			const val = getFn();
			if (isSignal(val)) {
				sourceSignal = val;
				sig.v = val.v;
			} else {
				sig.v = val;
			}
		}, true);
	};

	sig.onFirstSubscriber(init);
	sig.onLastSubscriberRemoved(() => {
		if (cleanup) {
			cleanup();
			cleanup = null;
		}
	});

	// Wrap for transparent setter
	return new Proxy(sig, {
		get(target, prop) {
			if (prop === 'v' && !cleanup) init();
			return sourceSignal ? sourceSignal[prop] : target[prop];
		},
		set(target, prop, val) {
			if (prop === 'v') {
				if (sourceSignal) {
					sourceSignal.v = val;
				} else if (setFn) {
					setFn(val);
				} else {
					console.warn('Cannot set read-only computed');
				}
				return true;
			}
			return Reflect.set(target, prop, val);
		}
	});
}

computed.async = function(getFn, setFn) {
	const sig = signal(null);
	let cleanup = null;
	let controller = null;

	const init = () => {
		if (cleanup) return;
		cleanup = effect(() => {
			if (controller) controller.abort();
			controller = new AbortController();
			const localCtrl = controller;

			sig.v = getFn(localCtrl.signal);

			return () => {
				if (localCtrl) localCtrl.abort();
			};
		});
	};

	sig.onFirstSubscriber(init);
	sig.onLastSubscriberRemoved(() => {
		if (controller) {
			controller.abort();
			controller = null;
		}
		if (cleanup) {
			cleanup();
			cleanup = null;
		}
	});

	return new Proxy(sig, {
		get(target, prop) {
			if (prop === 'v' && !cleanup) init();
			return target[prop];
		},
		set(target, prop, val) {
			if (prop === 'v') {
				if (setFn) setFn(val);
				else console.warn('Cannot set read-only async computed');
				return true;
			}
			return Reflect.set(target, prop, val);
		}
	});
};

computed.unpack = function(promiseSignal) {
	if (!promiseSignal) {
		return {
			fetcher: (url, opts = {}) => {
				const ps = computed.fetcher(url, opts);
				return computed.unpack(ps);
			}
		};
	}

	const sig = signal({ loading: false, error: undefined, data: undefined });
	let cleanup = null;
	let currentPromise = null;

	const init = () => {
		if (cleanup) return;
		cleanup = effect(async () => {
			const promise = promiseSignal.v;
			if (!promise) return;

			currentPromise = promise;
			sig.v = { loading: true, error: undefined, data: sig.v.data };

			try {
				const val = await promise;
				if (currentPromise === promise) {
					sig.v = { loading: false, error: undefined, data: val };
				}
			} catch (err) {
				if (currentPromise === promise && err.name !== 'AbortError') {
					sig.v = { loading: false, error: err, data: undefined };
				}
			}
		});
	};

	sig.onFirstSubscriber(init);
	sig.onLastSubscriberRemoved(() => {
		if (cleanup) {
			cleanup();
			cleanup = null;
			currentPromise = null;
		}
	});

	return new Proxy(sig, {
		get(target, prop) {
			if (prop === 'v' && !cleanup) init();
			return target[prop];
		},
		set() {
			console.warn('Cannot set unpacked signal');
			return true;
		}
	});
};

computed.fetcher = (url, opts = {}) => {
	const refresh = signal(0);

	const sig = computed(async (abortSignal) => {
		refresh.v; // Subscribe
		const urlVal = isSignal(url) ? url.v : url;
		const optsVal = isSignal(opts) ? opts.v : opts;
		return fetch(urlVal, { ...optsVal, signal: abortSignal });
	});

	return new Proxy(sig, {
		get(target, prop) {
			if (prop === 'refresh') {
				return () => refresh.v++;
			}
			if (prop === 'unpack') {
				return () => computed.unpack(target);
			}
			return target[prop];
		}
	});
};

computed.fromEvent = (target, eventName) => {
	const result = signal(null);
	let disposeEffect = null;
	let handler = null;

	const setup = (effectCreator) => {
		if (effectCreator) {
			const temp = signal(null);
			handler = (e) => temp.v = e;
			target.addEventListener(eventName, handler);

			const inner = effectCreator(() => result.v = temp.v);
			disposeEffect = () => {
				target.removeEventListener(eventName, handler);
				inner();
			};
		} else {
			handler = (e) => result.v = e;
			target.addEventListener(eventName, handler);
			disposeEffect = () => target.removeEventListener(eventName, handler);
		}
	};

	result.onFirstSubscriber(() => setup());
	result.onLastSubscriberRemoved(() => {
		if (disposeEffect) disposeEffect();
		target = null;
	});

	return new Proxy(result, {
		get(proxyTarget, prop) {
			if (prop === 'debounced') {
				return (delay) => {
					if (disposeEffect) disposeEffect();
					setup((fn) => effect.debounced(fn, delay));
					return proxyTarget;
				};
			}
			if (prop === 'throttled') {
				return (delay) => {
					if (disposeEffect) disposeEffect();
					setup((fn) => effect.throttled(fn, delay));
					return proxyTarget;
				};
			}
			return proxyTarget[prop];
		}
	});
};

// ============================================================================
// EFFECT - Flat implementation
// ============================================================================

function effect(fn, sync = false) {
	if (fn.constructor.name === 'AsyncFunction') {
		return effect.async(fn, sync);
	}

	let cleanupFromFn;

	const effectFn = () => {
		try {
			if (cleanupFromFn) cleanupFromFn();

			cleanupDeps(effectFn);
			const prev = currentEffect;
			currentEffect = effectFn;
			try {
				cleanupFromFn = wrapInContext(fn, { effect, untrack })();
			} catch (err) {
				console.error('Effect failed:', err);
			} finally {
				currentEffect = prev;
			}
		} catch (err) {
			console.error('Effect error:', err);
		}
	};

	effectFn.dependenciesCleanups = new Set();
	effectFn.dependencies = new Set();
	if (sync) effectFn.isSync = true;

	const cleanup = () => {
		if (cleanupFromFn) cleanupFromFn();
		cleanupDeps(effectFn);
		if (!sync) pendingEffects.delete(effectFn);
	};

	effectFn();
	return cleanup;
}

effect.deferredGeneric = function(fn, executor) {
	let deps;
	let innerEffect;
	let execCleanup;

	const execute = () => {
		const prev = currentEffect;
		currentEffect = innerEffect;
		wrapInContext(fn, { effect, untrack })();
		if (currentEffect) deps = new Set(currentEffect.dependencies);
		currentEffect = prev;
	};

	const cleanup = effect(() => {
		if (!deps) {
			fn();
			if (currentEffect) deps = new Set(currentEffect.dependencies);
			innerEffect = currentEffect;
		} else {
			for (let d of deps) d.v;
			execCleanup = executor(execute);
		}
		return () => execCleanup?.();
	});

	return () => {
		cleanup();
		deps?.clear();
		innerEffect = null;
		execCleanup?.();
	};
};

effect.UI = function(fn) {
	return effect.deferredGeneric(fn, (execute) => {
		let rafId = requestAnimationFrame(() => {
			rafId = null;
			execute();
		});
		return () => {
			if (rafId !== null) {
				cancelAnimationFrame(rafId);
				rafId = null;
			}
		};
	});
};

effect.debounced = function(fn, delay) {
	let timeoutId;
	return effect.deferredGeneric(fn, (execute) => {
		clearTimeout(timeoutId);
		timeoutId = setTimeout(execute, delay);
		return () => clearTimeout(timeoutId);
	});
};

effect.throttled = function(fn, delay) {
	let timeoutId;
	let intervalId;
	const cleanup = effect.deferredGeneric(fn, (execute) => {
		if (!intervalId) intervalId = setInterval(execute, delay);
		timeoutId = setTimeout(() => {
			clearInterval(intervalId);
			intervalId = null;
		}, delay);
		return () => clearTimeout(timeoutId);
	});
	return () => {
		cleanup();
		clearInterval(intervalId);
		clearTimeout(timeoutId);
	};
};

function untrack(fn) {
	const prev = currentEffect;
	currentEffect = null;
	try {
		return fn();
	} finally {
		currentEffect = prev;
	}
}

// Promise patching for async tracking
const origThen = Promise.prototype.then;
const origCatch = Promise.prototype.catch;
const origFinally = Promise.prototype.finally;

Promise.prototype.then = function(onFulfilled, onRejected) {
	const ctx = currentEffect;
	const wrapF = onFulfilled ? (v) => {
		currentEffect = ctx;
		return onFulfilled(v);
	} : undefined;
	const wrapR = onRejected ? (e) => {
		currentEffect = ctx;
		return onRejected(e);
	} : undefined;
	return origThen.call(this, wrapF, wrapR);
};

Promise.prototype.catch = function(onRejected) {
	const ctx = currentEffect;
	const wrapR = onRejected ? (e) => {
		currentEffect = ctx;
		return onRejected(e);
	} : undefined;
	return origCatch.call(this, wrapR);
};

Promise.prototype.finally = function(onFinally) {
	const ctx = currentEffect;
	const wrapF = onFinally ? () => {
		currentEffect = ctx;
		return onFinally();
	} : undefined;
	return origFinally.call(this, wrapF);
};

effect.async = function(fn, sync = false) {
	let cleanupFromFn;
	let controller;

	const effectFn = () => {
		try {
			if (controller) controller.abort();
			if (cleanupFromFn) {
				cleanupFromFn();
				cleanupFromFn = undefined;
			}

			controller = new AbortController();
			const localCtrl = controller;

			cleanupDeps(effectFn);
			const prev = currentEffect;
			currentEffect = effectFn;

			try {
				const result = wrapInContext(fn, { effect, untrack })(localCtrl.signal);

				if (result?.then) {
					result.then(
						(cleanup) => {
							if (cleanup && typeof cleanup === 'function') {
								cleanupFromFn = cleanup;
							}
						},
						(err) => {
							if (err.name !== 'AbortError') {
								console.error('Async effect failed:', err);
							}
						}
					);
				} else if (typeof result === 'function') {
					cleanupFromFn = result;
				}
			} catch (err) {
				console.error('Effect failed:', err);
			} finally {
				currentEffect = prev;
			}
		} catch (err) {
			console.error('Effect error:', err);
		}
	};

	effectFn.dependenciesCleanups = new Set();
	effectFn.dependencies = new Set();
	if (sync) effectFn.isSync = true;

	const cleanup = () => {
		if (controller) {
			controller.abort();
			controller = null;
		}
		if (cleanupFromFn) cleanupFromFn();
		cleanupDeps(effectFn);
		if (!sync) pendingEffects.delete(effectFn);
	};

	effectFn();
	return cleanup;
};

// ============================================================================
// MODIFIERS
// ============================================================================

function debounce(sigOrArray, delay) {
	if (Array.isArray(sigOrArray)) {
		const trigger = signal(0);
		let timeoutId;

		effect(() => {
			sigOrArray.forEach(s => isSignal(s) ? s.v : s);
			clearTimeout(timeoutId);
			timeoutId = setTimeout(() => trigger.v++, delay);
		});

		return sigOrArray.map(s => {
			return computed(
				() => {
					trigger.v;
					return isSignal(s) ? s.v : s;
				},
				(v) => {
					if (isSignal(s)) s.v = v;
				}
			);
		});
	}

	const trigger = signal(0);
	let timeoutId;

	effect(() => {
		sigOrArray.v;
		clearTimeout(timeoutId);
		timeoutId = setTimeout(() => trigger.v++, delay);
	});

	return computed(
		() => {
			trigger.v;
			return sigOrArray.v;
		},
		(v) => sigOrArray.v = v
	);
}

function throttle(sigOrArray, delay) {
	if (Array.isArray(sigOrArray)) {
		const trigger = signal(0);
		let intervalId;
		let timeoutId;

		effect(() => {
			sigOrArray.forEach(s => isSignal(s) ? s.v : s);
			if (!intervalId) {
				trigger.v++;
				intervalId = setInterval(() => trigger.v++, delay);
			}
			clearTimeout(timeoutId);
			timeoutId = setTimeout(() => {
				clearInterval(intervalId);
				intervalId = null;
			}, delay);
		});

		return sigOrArray.map(s => {
			return computed(
				() => {
					trigger.v;
					return isSignal(s) ? s.v : s;
				},
				(v) => {
					if (isSignal(s)) s.v = v;
				}
			);
		});
	}

	const trigger = signal(0);
	let intervalId;
	let timeoutId;

	effect(() => {
		sigOrArray.v;
		if (!intervalId) {
			trigger.v++;
			intervalId = setInterval(() => trigger.v++, delay);
		}
		clearTimeout(timeoutId);
		timeoutId = setTimeout(() => {
			clearInterval(intervalId);
			intervalId = null;
		}, delay);
	});

	return computed(
		() => {
			trigger.v;
			return sigOrArray.v;
		},
		(v) => sigOrArray.v = v
	);
}

// ============================================================================
// UTILITIES
// ============================================================================

const isSignal = (obj) => obj?.[SIGNAL_MARK] === true;

function queueEffects(subscribers) {
	subscribers.forEach(eff => {
		if (eff.isSync) {
			updateDepth++;
			if (updateDepth > MAX_DEPTH) {
				updateDepth = 0;
				throw new Error('Max update depth exceeded - infinite loop?');
			}
			try {
				eff();
			} finally {
				updateDepth--;
			}
		} else if (!pendingEffects.has(eff)) {
			pendingEffects.add(eff);
			if (!isFlushing) {
				isFlushing = true;
				queueMicrotask(flushEffects);
			}
		}
	});
}

function flushEffects() {
	flushCount++;
	if (flushCount > MAX_FLUSH) {
		flushCount = 0;
		pendingEffects.clear();
		isFlushing = false;
		throw new Error('Max flush count exceeded - infinite loop?');
	}

	const toRun = Array.from(pendingEffects);
	pendingEffects = new Set();
	isFlushing = false;

	toRun.forEach(eff => eff());

	if (pendingEffects.size === 0) {
		flushCount = 0;
	}
}

function cleanupDeps(effectFn) {
	effectFn.dependenciesCleanups.forEach(c => c());
	effectFn.dependenciesCleanups.clear();
}

export { signal, signal as state, computed, effect, isSignal, debounce, throttle, untrack };
