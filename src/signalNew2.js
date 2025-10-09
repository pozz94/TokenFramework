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

let currentEffect = null;  // Explicitly initialize as null
let pendingEffects = new Set();
let isFlushing = false;

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

//const infiniteSignalProxy = new Proxy({}, {
//	get(_, prop) {
//		if (prop === 'v') return undefined;
//		if (prop === 'onFirstSubscriber' || prop === 'onLastSubscriberRemoved') return null;
//        if (prop === 'getValue') return () => undefined;
//        if (prop === 'isSame') return () => false;
//        if (prop === 'getSelf') return () => infiniteSignalProxy;
//		return infiniteSignalProxy;
//	}
//});

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
		#arrayCacheEffect = null; // Effect to rebuild cache when array changes
		#subscribers = new Set();
		#onFirstSubscriber = null;
		#onLastSubscriberRemoved = null;

		constructor(initialValue) {
			this.#value = initialValue;
		}

		get v() {
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

			// Set up reactive cache rebuilding on first access
			if (!this.#arrayCacheEffect) {
				const parentNode = this;
				this.#arrayCacheEffect = effect(() => {
					const value = parentNode.v; // Subscribe to changes
					
					if (!isArray(value)) {
						parentNode.#cachedSignalArray = null;
						return;
					}
					
					// Rebuild cache when array or length changes
					const signalArray = [];
					for (let i = 0; i < value.length; i++) {
						signalArray[i] = parentNode.getPropertySignal(i);
					}
					parentNode.#cachedSignalArray = signalArray;
				});
			}

			// Return the reactively maintained cache
			return this.#cachedSignalArray;
		}

		getPropertySignal(prop) {
			if (this.#propertySignals.has(prop)) {
				return this.#propertySignals.get(prop);
			}

			const parentNode = this; // Capture reference to parent SignalNode

			const propSignal = computed({
				get: () => {
					// Subscribe to the PARENT signal, not the computed
					//const value = parentNode.v;
					parentNode.subscribe();
					return parentNode.v?.[prop];
				},
				set: (newValue) => {
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
			});

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
			// Handle core signal methods
			if (prop === 'v') { 
				target.subscribe(); 
				return target.v; 
			}
			if (prop === 'onFirstSubscriber') return target.onFirstSubscriber.bind(target);
			if (prop === 'onLastSubscriberRemoved') return target.onLastSubscriberRemoved.bind(target);
			if (prop === 'getValue') return target.getValue.bind(target);
			if (prop === 'isSame') return (other) => target.isSame(other);
			if (prop === 'getSelf') return () => target;

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

const isSignal = (obj) => isObject(obj) && 'v' in obj;

// Computed Values Implementation
function computed(computeFnOrConfig) {
	// Handle writable computed (new)
	if (isObject(computeFnOrConfig) && 'get' in computeFnOrConfig) {
		const { get, set } = computeFnOrConfig;
		// Compute initial value immediately
		const s = signal(get());
		let cleanup = null;

		const initialize = () => {
			if (!cleanup) {
				cleanup = effect(() => {
					s.v = get();
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
			}
		});

		return new Proxy(s, {
			get(target, prop) {
				// Set up the effect on first access to enable reactivity
				if (prop === 'v' && !cleanup) {
					initialize();
				}
				return target[prop];
			},
			set(target, prop, value) {
				if (prop === 'v') {
					if (set) {
						set(value);
						return true;
					} else {
						console.warn('Cannot set read-only computed signal');
						return false;
					}
				}
				return Reflect.set(target, prop, value);
			}
		});
	}

	// Handle read-only computed (existing behavior)
	if (isSignal(computeFnOrConfig)) return computeFnOrConfig;

	// Compute initial value immediately
	let initialValue = computeFnOrConfig();
	let sourceSignal;
	if (isSignal(initialValue)) {
		sourceSignal = initialValue;
		initialValue = initialValue.v;
	}
	
	const s = signal(initialValue);
	let cleanup = null;

	const initialize = () => {
		if (!cleanup) {
			cleanup = effect(() => {
				const newValue = computeFnOrConfig();
				if (isSignal(newValue)) {
					sourceSignal = newValue;
					s.v = newValue.v;
				} else {
					s.v = newValue;
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
			if (sourceSignal) {
				sourceSignal[prop] = value;
			} else {
				console.warn('Cannot set value on computed signal. Use the original signal instead.');
				return false;
			}
			return true;
		}
	});
}

const defaultFetcher = async (source) => {
	const sourceValue = isSignal(source) ? source.v : source;
	const { url, method = 'GET', body, headers = {}, signal } = typeof sourceValue === 'string' ? { url: sourceValue } : sourceValue;
	const response = await fetch(url, {
		method,
		headers: {
			'Content-Type': 'application/json',
			...headers
		},
		body: body ? JSON.stringify(body) : undefined,
		signal
	});

	if (!response.ok) {
		throw new Error(`HTTP error! status: ${response.status}`);
	}
	return response.json();
};

/**
 * Creates a resource signal that fetches data asynchronously.
 * 
 * @param {any} source - The source or configuration for fetching data.
 * @param {function} [fetcher=defaultFetcher] - Optional custom fetcher function.
 * @returns {SignalNode<{loading: boolean, error: any, data: any}> & {fetch: function(): void}} 
 *   A signal with properties: loading, error, data, and a fetch() method to manually trigger a fetch.
 */
computed.fromAPI = (source, fetcher = defaultFetcher) => {
	const result = signal({ loading: false, error: undefined, data: undefined });

	let controller;

	let fetchFunc = () => {
		controller = new AbortController();
		const localController = controller;

		result.v = { loading: true, error: undefined, data: undefined };

		fetcher(source)
			.then(value => { if (!localController.signal.aborted && controller === localController) { result.v = { loading: false, data: value, error: undefined }; } })
			.catch(err => { if (!localController.signal.aborted && controller === localController && err.name !== 'AbortError') { result.v = { loading: false, error: err, data: undefined }; } });
	};

	let disposeEffect;

	//result.onFirstSubscriber(() => {
	disposeEffect = effect(() => {
		fetchFunc();

		// Cleanup function that aborts the request
		return () => controller?.abort();
	});
	//});

	result.onLastSubscriberRemoved(() => { if (disposeEffect) disposeEffect() });

	//result.fetch = () => { controller?.abort(); fetchFunc(); };
	const resultProxy = new Proxy(result, {
		get(target, prop) {
			if (prop === 'fetch') {
				return () => { controller?.abort(); fetchFunc(); };
			}
			return target[prop];
		}
	});

	return resultProxy;
};

computed.fromEvent = (target, eventName) => {
	const result = signal(null);
	let disposeEffect;

	result.onFirstSubscriber(() => {
		const handler = (event) => result.v = event;
		target.addEventListener(eventName, handler);

		disposeEffect = () => {
			target.removeEventListener(eventName, handler);
		};
	});

	result.onLastSubscriberRemoved(() => {
		if (disposeEffect) disposeEffect();
		target = null;
	});

	return result;
};

/**
 * @param {Function} fn - function to be executed as an effect
 * @returns {Function} cleanup function to remove all dependencies and subscribers from the effect
 * @description
 * Effect is a function that takes a function as an argument and returns a cleanup function.
 * The cleanup function is used to remove all dependencies and subscribers from the effect.
 * Effects must be disposed of after use outside components using the cleanup function.
 */
function effect(fn) {
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

	const cleanup = () => {
		// Run both the dependency cleanup and the fn's own cleanup
		if (cleanupFromFn) {
			cleanupFromFn();
		}
		cleanupDependencies(effectFn);
		pendingEffects.delete(effectFn);
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
};

// Utility Functions
function queueEffects(subscribers) {
	subscribers.forEach(effect => {
		if (!pendingEffects.has(effect)) {
			pendingEffects.add(effect);
			if (!isFlushing) {
				isFlushing = true;
				queueMicrotask(flushEffects);
			}
		}
	});
}

function flushEffects() {
	const effectsToRun = Array.from(pendingEffects);
	pendingEffects = new Set();
	isFlushing = false;
	effectsToRun.forEach(effect => effect());
}

function cleanupDependencies(effectFn) {
	effectFn.dependenciesCleanups.forEach(cleanup => cleanup());
	effectFn.dependenciesCleanups.clear();
}

export { signal, computed, effect, isSignal };