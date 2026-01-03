import { wrapInContext } from './utils.js';

/**
 * Represents a node in a signal graph that can contain a value and be observed.
 * 
 * @template T - The type of value stored in this signal node
 * @typedef {Object} SignalNode
 * 
 * @property {T} v - The current value of the signal
 * 
 * @property {function(callback: function(): void): SignalNode<T>} onFirstSubscriber - Registers a callback to be
 *   executed when the first subscriber is added to this signal
 * @property {function(callback: function(): void): SignalNode<T>} onLastSubscriberRemoved - Registers a callback to be
 *   executed when the last subscriber is removed from this signal
 * 
 * @property {SignalNode<any>} [key: string] - Allows any property to be accessed as a signal
 */

// Symbol to mark signal objects for O(1) detection
const SIGNAL_MARKER = Symbol('__signal__');

let currentEffect = null;  // Explicitly initialize as null
let pendingEffects = new Set();
let isFlushing = false;
let updateDepth = 0;
const MAX_UPDATE_DEPTH = 100;
let flushCount = 0;
const MAX_FLUSH_COUNT = 100;

const isObject = (obj) => obj && typeof obj === 'object';
const isArray = (arr) => Array.isArray(arr);
const isPlainObject = (obj) => isObject(obj) && Object.getPrototypeOf(obj) === Object.prototype;

// Helper function to check if objects have the same keys
function objectsHaveSameKeys(obj1, obj2) {
	const keys1 = Object.keys(obj1);
	const keys2 = Object.keys(obj2);
	return keys1.length === keys2.length &&
		keys1.every(key => key in obj2);
}

// Core Signal Implementation
/**
 * 
 * @param {*} initialValue - initial value of the signal
 * @returns - signal object with get and set properties
 */
// Core Signal Implementation
function signal(initialValue) {
	class SignalNode {
		#value;
		#propertySignals = new Map(); // Persistent cache for property signals
		#cachedSignalArray = null; // Cache the signal array structure
		#subscribers = new Set();
		#onFirstSubscriber = null;
		#onLastSubscriberRemoved = null;

		constructor(initialValue) {
			this.#value = initialValue;
		}

		get v() {
			this.subscribe();
			return this.#value;
		}

		subscribe() {
			if (currentEffect) {
				if (!this.#subscribers.has(currentEffect)) {
					if (this.#subscribers.size === 0 && this.#onFirstSubscriber) {
						this.#onFirstSubscriber();
					}
					this.#subscribers.add(currentEffect);
					currentEffect.dependenciesCleanups.add(() => {
						this.#subscribers.delete(currentEffect);
						if (this.#subscribers.size === 0 && this.#onLastSubscriberRemoved) {
							this.#onLastSubscriberRemoved();
						}
					});
					currentEffect.dependencies.add(this);
				}
			}
		}

		set v(newValue) {
			// Reference equality check
			if (this.#value === newValue) return;
			
			this.#value = newValue;
			queueEffects(this.#subscribers);
		}

		notifyChange() {
			queueEffects(this.#subscribers);
		}

		onFirstSubscriber(cb) {
			this.#onFirstSubscriber = cb;
			if (this.#subscribers.size > 0 && this.#onFirstSubscriber) {
				this.#onFirstSubscriber();
			}
			return proxySignal;
		}

		onLastSubscriberRemoved(cb) {
			this.#onLastSubscriberRemoved = cb;
			return proxySignal;
		}

		getSubscribers() {
			return this.#subscribers;
		}

		getValue() {
			return this.#value;
		}

		getSignalArray() {
			if (!isArray(this.#value)) {
				return null;
			}

			// Initialize cache if needed
			if (!this.#cachedSignalArray) {
				this.#cachedSignalArray = [];
			}

			// Extend cache if array grew - only create signals for new indices
			const currentLength = this.#value.length;
			while (this.#cachedSignalArray.length < currentLength) {
				const index = this.#cachedSignalArray.length;
				this.#cachedSignalArray.push(this.getPropertySignal(index));
			}

			// Shrink cache if array shrank (keep references valid but don't expose them)
			if (this.#cachedSignalArray.length > currentLength) {
				this.#cachedSignalArray.length = currentLength;
			}

			return this.#cachedSignalArray;
		}

		getPropertySignal(prop) {
			if (this.#propertySignals.has(prop)) {
				return this.#propertySignals.get(prop);
			}

			const parentNode = this; // Capture reference to parent SignalNode

			const propSignal = computed(
				// Getter
				() => {
					// Subscribe to the PARENT signal, not the computed
					//parentNode.subscribe();
					return parentNode.v?.[prop];
				},
				// Setter
				(newValue) => {
					const current = parentNode.#value;
					if (isArray(current)) {
						const newArray = [...current];
						newArray[prop] = newValue;
						parentNode.v = newArray;
					} else if (isPlainObject(current)) {
						parentNode.v = { ...current, [prop]: newValue };
					} else if (current === null || current === undefined) {
						parentNode.v = { [prop]: newValue };
					} else {
						console.warn(`Cannot set property "${prop}" on non-object value:`, current);
					}
				}
			);

			propSignal.onLastSubscriberRemoved(() => {
				this.#propertySignals.delete(prop);
			});

			this.#propertySignals.set(prop, propSignal);
			return propSignal;
		}

		isSame(otherSignal) {
			// First check if they're the same SignalNode
			const otherNode = otherSignal && isSignal(otherSignal) ?
				otherSignal.getSelf() : otherSignal;
			const isSameNode = this === otherNode;
			
			if (isSameNode) {
				return true;
			}
			
			// If not the same node, check if they're property signals pointing to the same value
			// This handles the case where different property signals point to the same array element
			if (otherSignal && isSignal(otherSignal)) {
				const thisValue = this.v;
				const otherValue = otherSignal.getSelf().v;
				
				// For objects, use reference equality
				if (isObject(thisValue) && isObject(otherValue)) {
					return thisValue === otherValue;
				}
			}
			
			return false;
		}
	}

	const signalNode = new SignalNode(initialValue);

	const proxySignal = new Proxy(signalNode, {
		get(target, prop) {
			// Handle symbols - return marker for signal identification
			if (typeof prop === 'symbol') {
				if (prop === SIGNAL_MARKER) return true;
				return target[prop];
			}
			
			// Handle core signal methods
			if (prop === 'v') {
				//target.subscribe();
				return target.v;
			}
			if (prop === 'onFirstSubscriber') return target.onFirstSubscriber.bind(target);
			if (prop === 'onLastSubscriberRemoved') return target.onLastSubscriberRemoved.bind(target);
			if (prop === 'getValue') return target.getValue.bind(target);
			if (prop === 'isSame') return (other) => target.isSame(other);
			if (prop === 'getSelf') return () => target;

			// Timing modifiers - available on ALL signals
			if (prop === 'debounce') {
				return (delay) => debounce(proxySignal, delay);
			}
			if (prop === 'throttle') {
				return (delay) => throttle(proxySignal, delay);
			}

			const internalValue = target.getValue();
			
			// For arrays: check if accessing numeric index or iterator
			if (isArray(internalValue)) {
				// Return signal array methods directly from the cache!
				if (typeof Array.prototype[prop] === 'function') {
					const mutatingMethods = ['push', 'pop', 'shift', 'unshift', 'splice', 'sort', 'reverse'];
					
					if (mutatingMethods.includes(prop)) {
						return function(...args) {
							// Clone the array
							const newArray = [...internalValue];
							
							// Apply the method to the clone
							const result = Array.prototype[prop].apply(newArray, args);
							
							// Trigger update with new array
							target.v = newArray;
							
							return result;
						};
					}
					
					// Non-mutating methods: get cache and call method DIRECTLY on it
					const signalArray = target.getSignalArray();
					return signalArray[prop].bind(signalArray);
				}
				
				// Handle numeric indices and length from cache
				if (prop === 'length') {
					return internalValue.length;
				}
				
				// Numeric index: return from signal array cache
				const numericIndex = Number(prop);
				if (Number.isInteger(numericIndex) && numericIndex >= 0) {
					const signalArray = target.getSignalArray();
					return signalArray?.[numericIndex];
				}
			}

			// For all other properties, return the property signal
			return target.getPropertySignal(prop);
		},

		set(target, prop, value) {
			if (prop === 'v') {
				target.v = value;
				return true;
			}

			if (prop === 'onFirstSubscriber' || prop === 'onLastSubscriberRemoved') {
				target[prop](value);
				return true;
			}

			// Set through the property signal
			const propSignal = target.getPropertySignal(prop);
			propSignal.v = value;
			return true;
		}
	});

	return proxySignal;
}

// Fast O(1) signal detection using symbol marker
const isSignal = (obj) => obj?.[SIGNAL_MARKER] === true;

/**
 * Debounces a signal or array of signals
 * @param {SignalNode|SignalNode[]} signalOrArray - Single signal or array of signals to debounce
 * @param {number} delay - Delay in milliseconds
 * @returns {SignalNode|SignalNode[]} Debounced signal(s)
 */
function debounce(signalOrArray, delay) {
	// Handle array of signals
	if (Array.isArray(signalOrArray)) {
		const trigger = signal(0);
		let timeoutId;

		// Watch all signals and debounce together
		effect(() => {
			signalOrArray.forEach(sig => isSignal(sig) ? sig.v : sig);

			clearTimeout(timeoutId);
			timeoutId = setTimeout(() => {
				trigger.v = trigger.v + 1;
			}, delay);
		});

		// Return array of debounced signals
		return signalOrArray.map(sig => {
			return computed(() => {
				trigger.v; // Subscribe to debounced trigger
				return isSignal(sig) ? sig.v : sig;
			}, (value) => {
				// Write directly to source signal
				if (isSignal(sig)) {
					sig.v = value;
				}
			});
		});
	}

	// Handle single signal
	const trigger = signal(0);
	let timeoutId;

	effect(() => {
		signalOrArray.v;

		clearTimeout(timeoutId);
		timeoutId = setTimeout(() => {
			trigger.v = trigger.v + 1;
		}, delay);
	});

	return computed(() => {
		trigger.v; // Subscribe to debounced trigger
		return signalOrArray.v;
	}, (value) => {
		// Write directly to source signal
		signalOrArray.v = value;
	});
}

/**
 * Throttles a signal or array of signals
 * @param {SignalNode|SignalNode[]} signalOrArray - Single signal or array of signals to throttle
 * @param {number} delay - Minimum time between updates in milliseconds
 * @returns {SignalNode|SignalNode[]} Throttled signal(s)
 */
function throttle(signalOrArray, delay) {
	// Handle array of signals
	if (Array.isArray(signalOrArray)) {
		const trigger = signal(0);
		let intervalId;
		let timeoutId;

		// Watch all signals and throttle together
		effect(() => {
			signalOrArray.forEach(sig => isSignal(sig) ? sig.v : sig);

			if (!intervalId) {
				// First change triggers immediately
				trigger.v = trigger.v + 1;

				// Set up interval for subsequent changes
				intervalId = setInterval(() => {
					trigger.v = trigger.v + 1;
				}, delay);
			}

			// Clear interval after delay of no changes
			clearTimeout(timeoutId);
			timeoutId = setTimeout(() => {
				clearInterval(intervalId);
				intervalId = null;
			}, delay);
		});

		// Return array of throttled signals
		return signalOrArray.map(sig => {
			return computed(() => {
				trigger.v; // Subscribe to throttled trigger
				return isSignal(sig) ? sig.v : sig;
			}, (value) => {
				// Write directly to source signal
				if (isSignal(sig)) {
					sig.v = value;
				}
			});
		});
	}

	// Handle single signal
	const trigger = signal(0);
	let intervalId;
	let timeoutId;

	effect(() => {
		signalOrArray.v;

		if (!intervalId) {
			// First change triggers immediately
			trigger.v = trigger.v + 1;

			// Set up interval for subsequent changes
			intervalId = setInterval(() => {
				trigger.v = trigger.v + 1;
			}, delay);
		}

		// Clear interval after delay of no changes
		clearTimeout(timeoutId);
		timeoutId = setTimeout(() => {
			clearInterval(intervalId);
			intervalId = null;
		}, delay);
	});

	return computed(() => {
		trigger.v; // Subscribe to throttled trigger
		return signalOrArray.v;
	}, (value) => {
		// Write directly to source signal
		signalOrArray.v = value;
	});
}

// Computed Values Implementation
function computed(getFnOrSignal, set = () => {
		console.warn('Cannot set read-only computed signal');
		console.trace('Stack trace:');
		return false;
	}) {
	// If already a signal, return as-is
	if (isSignal(getFnOrSignal)) return getFnOrSignal;

	// Detect if the function is async
	const isAsyncFn = typeof getFnOrSignal === 'function' && getFnOrSignal.constructor.name === 'AsyncFunction';

	// If it's an async function, return a promise-based signal
	if (isAsyncFn) {
		return computed.async(getFnOrSignal, set);
	}

	const s = signal(undefined);
	let sourceSignal;
	let cleanup = null;

	const initialize = () => {
		if (!cleanup) {
			cleanup = effect(() => {
				const newValue = getFnOrSignal();
				if (isSignal(newValue)) {
					sourceSignal = newValue;
					s.v = newValue.v;
				} else {
					s.v = newValue;
				}
			}, true); // Run synchronously
		}
	};

	s.onFirstSubscriber(() => {
		initialize();
	});

	s.onLastSubscriberRemoved(() => {
		if (cleanup) {
			cleanup();
			cleanup = null;
		}
	});

	return new Proxy(s, {
		get(target, prop) {
			// Set up the effect on first access to enable reactivity
			if (prop === 'v' && !cleanup) {
				initialize();
			}
			return sourceSignal ? sourceSignal[prop] : target[prop];
		},
		set(target, prop, value) {
			if (prop === 'v') {
				if (sourceSignal) {
					sourceSignal.v = value;
				} else {
					set(value);
				}
				return true;
			}
			return Reflect.set(target, prop, value);
		}
	});
}

/**
 * Creates an async computed signal that returns a promise
 * @param {Function} getFn - Async function that receives an AbortSignal and returns a promise
 * @param {Function} set - Optional setter function
 * @returns {SignalNode} A signal that holds a promise which resolves to the computed value
 */
computed.async = function(getFn, set) {
	const s = signal(null);
	let cleanup = null;
	let controller = null;

	const initialize = () => {
		if (!cleanup) {
			cleanup = effect(() => {
				// Abort previous operation if still running
				if (controller) {
					controller.abort();
				}

				controller = new AbortController();
				const localController = controller;

				// Create and store the promise
				const promise = getFn(localController.signal);
				s.v = promise;

				// Return cleanup function to abort on next run or disposal
				return () => {
					if (localController) {
						localController.abort();
					}
				};
			});
		}
	};

	s.onFirstSubscriber(() => {
		initialize();
	});

	s.onLastSubscriberRemoved(() => {
		if (controller) {
			controller.abort();
			controller = null;
		}
		if (cleanup) {
			cleanup();
			cleanup = null;
		}
	});

	return new Proxy(s, {
		get(target, prop) {
			if (prop === 'v' && !cleanup) {
				initialize();
			}
			return target[prop];
		},
		set(target, prop, value) {
			if (prop === 'v') {
				if (set) {
					set(value);
				} else {
					console.warn('Cannot set read-only async computed signal');
				}
				return true;
			}
			return Reflect.set(target, prop, value);
		}
	});
};

/**
 * Creates a modifier that unpacks promise-based signals into {loading, error, data} structure
 * Can be used as: computed.unpack(promiseSignal) or computed.unpack().fetch(url)
 * @param {SignalNode} [promiseSignal] - Optional signal that holds promises
 * @returns {SignalNode|Object} Either an unpacked signal or a builder object
 */
computed.unpack = function(promiseSignal) {
	// If called with a signal, unpack it directly
	if (promiseSignal && isSignal(promiseSignal)) {
		const s = signal({ loading: false, error: undefined, data: undefined });
		let cleanup = null;
		let currentPromise = null;

		const initialize = () => {
			if (!cleanup) {
				cleanup = effect(async () => {
					const promise = promiseSignal.v;

					// If no promise yet, do nothing
					if (!promise) {
						return;
					}

					// Track which promise we're handling
					currentPromise = promise;

					s.v = { loading: true, error: undefined, data: s.v.data };

					try {
						const value = await promise;

						// Only update if this is still the current promise
						if (currentPromise === promise) {
							s.v = { loading: false, error: undefined, data: value };
						}
					} catch (error) {
						// Only update error if this is still the current promise and not an abort
						if (currentPromise === promise && error.name !== 'AbortError') {
							s.v = { loading: false, error: error, data: undefined };
						}
					}
				});
			}
		};

		s.onFirstSubscriber(() => {
			initialize();
		});

		s.onLastSubscriberRemoved(() => {
			if (cleanup) {
				cleanup();
				cleanup = null;
				currentPromise = null;
			}
		});

		return new Proxy(s, {
			get(target, prop) {
				if (prop === 'v' && !cleanup) {
					initialize();
				}
				return target[prop];
			},
			set(target, prop, value) {
				console.warn('Cannot set unpacked signal');
				return true;
			}
		});
	}

	// If called without arguments, return a builder
	return {
		fetcher: (url, options = {}) => {
			const promiseSignal = computed.fetcher(url, options);
			return computed.unpack(promiseSignal);
		}
	};
};

/**
 * Creates a resource signal that fetches data asynchronously.
 * Returns a promise-based signal. Use .unpack() to get {loading, error, data} structure.
 * Use .debounce()/.throttle() for timing control.
 *
 * @param {any} url - The URL to fetch (can be a signal or static value)
 * @param {any} [options={}] - Fetch options (can be a signal or static value)
 * @returns {SignalNode<Promise> & {refresh: function(): void, unpack: function()}}
 *   A promise-based signal with refresh() and unpack() methods
 */
computed.fetcher = (url, options = {}) => {
	const refreshTrigger = signal(0);

	const fetcherSignal = computed(async (signal) => {
		refreshTrigger.v; // Subscribe to refresh trigger

		const urlValue = isSignal(url) ? url.v : url;
		const optionsValue = isSignal(options) ? options.v : options;

		// Add abort signal to fetch options
		return fetch(urlValue, { ...optionsValue, signal });
	});

	// Add refresh and unpack methods
	const resultProxy = new Proxy(fetcherSignal, {
		get(target, prop) {
			if (prop === 'refresh') {
				return () => {
					refreshTrigger.v = refreshTrigger.v + 1;
				};
			}

			// UNPACK modifier: Convert promise to {loading, error, data}
			if (prop === 'unpack') {
				return () => {
					return computed.unpack(target);
				};
			}

			return target[prop];
		}
	});

	return resultProxy;
};

computed.fromEvent = (target, eventName) => {
	const result = signal(null);
	let disposeEffect;
	let handler;

	const setupListener = (effectCreator = null) => {
		if (effectCreator) {
			// Debounced or throttled version
			const tempSignal = signal(null);
			handler = (event) => tempSignal.v = event;
			target.addEventListener(eventName, handler);

			const innerEffect = effectCreator(() => {
				result.v = tempSignal.v;
			});

			disposeEffect = () => {
				target.removeEventListener(eventName, handler);
				innerEffect();
			};
		} else {
			// Immediate version
			handler = (event) => result.v = event;
			target.addEventListener(eventName, handler);

			disposeEffect = () => {
				target.removeEventListener(eventName, handler);
			};
		}
	};

	result.onFirstSubscriber(() => {
		setupListener();
	});

	result.onLastSubscriberRemoved(() => {
		if (disposeEffect) disposeEffect();
		target = null;
	});

	const resultProxy = new Proxy(result, {
		get(proxyTarget, prop) {
			if (prop === 'debounced') {
				return (delay) => {
					// Clean up existing listener
					if (disposeEffect) disposeEffect();

					// Re-setup with debounced effect
					setupListener((fn) => effect.debounced(fn, delay));

					return resultProxy;
				};
			}
			if (prop === 'throttled') {
				return (delay) => {
					// Clean up existing listener
					if (disposeEffect) disposeEffect();

					// Re-setup with throttled effect
					setupListener((fn) => effect.throttled(fn, delay));

					return resultProxy;
				};
			}
			return proxyTarget[prop];
		}
	});

	return resultProxy;
};

/**
 * @param {Function} fn - function to be executed as an effect
 * @param {boolean} sync - if true, effect runs synchronously without batching (default: false)
 * @returns {Function} cleanup function to remove all dependencies and subscribers from the effect
 * @description
 * Effect is a function that takes a function as an argument and returns a cleanup function.
 * The cleanup function is used to remove all dependencies and subscribers from the effect.
 * Effects must be disposed of after use outside components using the cleanup function.
 * When sync is true, the effect runs immediately when dependencies change, useful for counter increments.
 * Automatically detects async functions and enables async tracking.
 */
function effect(fn, sync = false) {
	// Detect if the function is async
	const isAsyncFn = fn.constructor.name === 'AsyncFunction';

	// If it's an async function, delegate to effect.async
	if (isAsyncFn) {
		return effect.async(fn, sync);
	}

	let cleanupFromFn = undefined;

	const effectFn = () => {
		try {
			// Run any existing cleanup from previous run
			if (cleanupFromFn && typeof cleanupFromFn === 'function') {
				cleanupFromFn();
			}

			cleanupDependencies(effectFn);
			const previousEffect = currentEffect;  // Save previous effect
			currentEffect = effectFn;
			try {
				cleanupFromFn = wrapInContext(fn, { effect, untrack })();
			} catch (error) {
				console.error('Effect execution failed:', error);
				// Still restore currentEffect in finally block
			} finally {
				currentEffect = previousEffect;
			}
		} catch (error) {
			console.error('Error in effect:', error);
		}
	};

	effectFn.dependenciesCleanups = new Set();
	effectFn.dependencies = new Set();

	// Mark synchronous effects
	if (sync) {
		effectFn.isSync = true;
	}

	const cleanup = () => {
		// Run both the dependency cleanup and the fn's own cleanup
		if (cleanupFromFn) {
			cleanupFromFn();
		}
		cleanupDependencies(effectFn);
		if (!sync) {
			pendingEffects.delete(effectFn);
		}
	};

	effectFn();
	return cleanup;
}

effect.deferredGeneric = function (fn, executor) {
	let dependencies;
	let innerEffect;
	let executorCleanup;

	const execute = () => {
		const previousEffect = currentEffect;
		currentEffect = innerEffect;
		wrapInContext(fn, { effect, untrack })();
		if (currentEffect) dependencies = new Set(currentEffect.dependencies);
		currentEffect = previousEffect;
	};

	const cleanup = effect(() => {
		if (!dependencies) {
			fn();
			if (currentEffect) dependencies = new Set(currentEffect.dependencies);
			innerEffect = currentEffect;
		} else {
			for (let dep of dependencies) dep.v;
			executorCleanup = executor(execute);
		}

		return () => executorCleanup?.();
	});

	return () => { cleanup(); dependencies?.clear(); innerEffect = null; executorCleanup?.(); };
};

effect.UI = function (fn) {
	const executor = (execute) => {
		let rafId = null;
		if (!rafId) {
			rafId = requestAnimationFrame(() => {
				rafId = null;
				execute();
			});
		}
		return () => {
			if (rafId !== null) {
				cancelAnimationFrame(rafId);
				rafId = null;
			}
		};
	};
	return effect.deferredGeneric(fn, executor);
};

effect.debounced = function (fn, delay) {
	let timeoutId;
	const executor = (execute) => {
		clearTimeout(timeoutId);
		timeoutId = setTimeout(() => {
			execute();
		}, delay);
		return () => clearTimeout(timeoutId);
	};
	return effect.deferredGeneric(fn, executor);
};

effect.throttled = function (fn, delay) {
	let timeoutId;
	let IntervalId;
	const executor = (execute) => {
		if (!IntervalId) IntervalId = setInterval(execute, delay);
		timeoutId = setTimeout(() => { clearInterval(IntervalId); IntervalId = null; }, delay);
		return () => clearTimeout(timeoutId);
	};
	const cleanup = effect.deferredGeneric(fn, executor);
	return () => { cleanup(); clearInterval(IntervalId); clearTimeout(timeoutId); };
};

function untrack(fn) {
	const previousEffect = currentEffect;
	currentEffect = null;
	try {
		return fn();
	} finally {
		currentEffect = previousEffect;
	}
}

// Patch Promise prototype to automatically track effect context
const originalThen = Promise.prototype.then;
const originalCatch = Promise.prototype.catch;
const originalFinally = Promise.prototype.finally;

Promise.prototype.then = function(onFulfilled, onRejected) {
	const effectContext = currentEffect;

	const wrappedOnFulfilled = onFulfilled ? function(value) {
		currentEffect = effectContext;
		return onFulfilled(value);
	} : undefined;

	const wrappedOnRejected = onRejected ? function(error) {
		currentEffect = effectContext;
		return onRejected(error);
	} : undefined;

	return originalThen.call(this, wrappedOnFulfilled, wrappedOnRejected);
};

Promise.prototype.catch = function(onRejected) {
	const effectContext = currentEffect;

	const wrappedOnRejected = onRejected ? function(error) {
		currentEffect = effectContext;
		return onRejected(error);
	} : undefined;

	return originalCatch.call(this, wrappedOnRejected);
};

Promise.prototype.finally = function(onFinally) {
	const effectContext = currentEffect;

	const wrappedOnFinally = onFinally ? function() {
		currentEffect = effectContext;
		return onFinally();
	} : undefined;

	return originalFinally.call(this, wrappedOnFinally);
};

/**
 * Creates an async effect that can track signal dependencies across async boundaries
 * Automatically tracks all promises via the patched Promise.prototype
 * @param {Function} fn - Async function that receives an AbortSignal to be executed as an effect
 * @param {boolean} sync - if true, effect runs synchronously without batching (default: false)
 * @returns {Function} cleanup function
 */
effect.async = function(fn, sync = false) {
	let cleanupFromFn = undefined;
	let controller = null;

	const effectFn = () => {
		try {
			// Abort previous operation if still running
			if (controller) {
				controller.abort();
			}

			// Run any existing cleanup from previous run
			if (cleanupFromFn && typeof cleanupFromFn === 'function') {
				cleanupFromFn();
				cleanupFromFn = undefined;
			}

			controller = new AbortController();
			const localController = controller;

			cleanupDependencies(effectFn);
			const previousEffect = currentEffect;
			currentEffect = effectFn;

			try {
				const result = wrapInContext(fn, { effect, untrack })(localController.signal);

				// If the result is a promise, handle cleanup from it
				if (result && typeof result.then === 'function') {
					result.then(
						(cleanup) => {
							if (cleanup && typeof cleanup === 'function') {
								cleanupFromFn = cleanup;
							}
						},
						(error) => {
							// Ignore AbortError
							if (error.name !== 'AbortError') {
								console.error('Async effect execution failed:', error);
							}
						}
					);
				} else if (result && typeof result === 'function') {
					cleanupFromFn = result;
				}
			} catch (error) {
				console.error('Effect execution failed:', error);
			} finally {
				currentEffect = previousEffect;
			}
		} catch (error) {
			console.error('Error in effect:', error);
		}
	};

	effectFn.dependenciesCleanups = new Set();
	effectFn.dependencies = new Set();

	if (sync) {
		effectFn.isSync = true;
	}

	const cleanup = () => {
		if (controller) {
			controller.abort();
			controller = null;
		}
		if (cleanupFromFn) {
			cleanupFromFn();
		}
		cleanupDependencies(effectFn);
		if (!sync) {
			pendingEffects.delete(effectFn);
		}
	};

	effectFn();
	return cleanup;
};

// Utility Functions
function queueEffects(subscribers) {
	subscribers.forEach(effect => {
		// Run synchronous effects immediately
		if (effect.isSync) {
			updateDepth++;
			if (updateDepth > MAX_UPDATE_DEPTH) {
				updateDepth = 0;
				throw new Error('Maximum update depth exceeded - possible infinite loop detected');
			}
			try {
				effect();
			} finally {
				updateDepth--;
			}
		} else if (!pendingEffects.has(effect)) {
			pendingEffects.add(effect);
			if (!isFlushing) {
				isFlushing = true;
				queueMicrotask(flushEffects);
			}
		}
	});
}

function flushEffects() {
	flushCount++;
	if (flushCount > MAX_FLUSH_COUNT) {
		flushCount = 0;
		pendingEffects.clear();
		isFlushing = false;
		throw new Error('Maximum flush count exceeded - possible infinite loop detected');
	}
	
	const effectsToRun = Array.from(pendingEffects);
	pendingEffects = new Set();
	isFlushing = false;
	
	effectsToRun.forEach(effect => effect());
	
	// Reset counter if we successfully complete without queuing more effects
	if (pendingEffects.size === 0) {
		flushCount = 0;
	}
}

function cleanupDependencies(effectFn) {
	effectFn.dependenciesCleanups.forEach(cleanup => cleanup());
	effectFn.dependenciesCleanups.clear();
}

export { signal, signal as state, computed, effect, isSignal, debounce, throttle, untrack };