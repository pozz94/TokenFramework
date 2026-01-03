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

	// If it's an async function, use {loading, error, data} structure
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
 * Creates an async computed signal that returns {loading, error, data} structure
 * @param {Function} getFn - Async function that receives an AbortSignal and returns a promise
 * @param {Function} set - Optional setter function
 * @returns {SignalNode} A signal with {loading: boolean, error: any, data: any} structure
 */
computed.async = function(getFn, set) {
	const s = signal({ loading: false, error: undefined, data: undefined });
	let cleanup = null;
	let controller = null;

	const initialize = () => {
		if (!cleanup) {
			cleanup = effect(async () => {
				// Abort previous operation if still running
				if (controller) {
					controller.abort();
				}

				controller = new AbortController();
				const localController = controller;

				s.v = { loading: true, error: undefined, data: undefined };
				try {
					const promise = getFn(localController.signal);
					const value = await promise;

					// Only update if this is still the current operation
					if (controller === localController && !localController.signal.aborted) {
						s.v = { loading: false, error: undefined, data: value };
					}
				} catch (error) {
					// Only update error if this is still the current operation and not an abort
					if (controller === localController && !localController.signal.aborted && error.name !== 'AbortError') {
						s.v = { loading: false, error: error, data: undefined };
					}
				}

				// Cleanup function to abort on next run or disposal
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

const defaultFetcher = async (url, options = {}) => {
	const response = await fetch(url, {
		method: options.method || 'GET',
		headers: {
			'Content-Type': 'application/json',
			...options.headers
		},
		body: options.body ? JSON.stringify(options.body) : undefined,
		signal: options.signal
	});

	if (!response.ok) {
		throw new Error(`HTTP error! status: ${response.status}`);
	}
	return response.json();
};

/**
 * Creates a resource signal that fetches data asynchronously.
 *
 * @param {any} url - The URL to fetch (can be a signal or static value)
 * @param {any} [options={}] - Fetch options (can be a signal or static value). Can also be a custom fetcher function for backward compatibility.
 * @returns {SignalNode<{loading: boolean, error: any, data: any}> & {refresh: function(): void, debounced: function(number): SignalNode, throttled: function(number): SignalNode}}
 *   A signal with properties: loading, error, data, and methods: refresh(), debounced(delay), throttled(delay)
 */
computed.fetcher = (url, options = {}) => {
	const result = signal({ loading: false, error: undefined, data: undefined });

	// Backward compatibility: if options is a function, treat it as a custom fetcher
	const isCustomFetcher = typeof options === 'function';
	const fetcher = isCustomFetcher ? options : defaultFetcher;

	let controller;

	let fetchFunc = () => {
		controller = new AbortController();
		const localController = controller;

		result.v = { loading: true, error: undefined, data: undefined };

		const urlValue = isSignal(url) ? url.v : url;
		const optionsValue = isCustomFetcher ? url : (isSignal(options) ? options.v : options);

		// Add abort controller to options
		const fetchOptions = isCustomFetcher ? optionsValue : { ...optionsValue, signal: localController.signal };

		const fetchPromise = isCustomFetcher
			? fetcher(fetchOptions)
			: fetcher(urlValue, fetchOptions);

		fetchPromise
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

	const resultProxy = new Proxy(result, {
		get(target, prop) {
			if (prop === 'refresh') {
				return () => { controller?.abort(); fetchFunc(); };
			}
			if (prop === 'debounced') {
				return (delay) => {
					// Clean up the immediate effect
					if (disposeEffect) disposeEffect();

					// Create a debounced computed that watches both url and options
					const debouncedTrigger = computed.debounced(() => {
						const urlVal = isSignal(url) ? url.v : url;
						const optsVal = isSignal(options) ? options.v : options;
						return { url: urlVal, options: optsVal };
					}, delay);

					// Re-create the effect with the debounced trigger
					disposeEffect = effect(() => {
						debouncedTrigger.v; // Subscribe to debounced trigger
						fetchFunc();
						return () => controller?.abort();
					});

					return resultProxy;
				};
			}
			if (prop === 'throttled') {
				return (delay) => {
					// Clean up the immediate effect
					if (disposeEffect) disposeEffect();

					// Create a throttled computed that watches both url and options
					const throttledTrigger = computed.throttled(() => {
						const urlVal = isSignal(url) ? url.v : url;
						const optsVal = isSignal(options) ? options.v : options;
						return { url: urlVal, options: optsVal };
					}, delay);

					// Re-create the effect with the throttled trigger
					disposeEffect = effect(() => {
						throttledTrigger.v; // Subscribe to throttled trigger
						fetchFunc();
						return () => controller?.abort();
					});

					return resultProxy;
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
 * Helper to create a computed signal with a specific effect type
 */
function createDeferredComputed(getFnOrSignal, effectCreator, set) {
	const s = signal(undefined);
	let sourceSignal;
	let cleanup = null;

	const initialize = () => {
		if (!cleanup) {
			cleanup = effectCreator(() => {
				const newValue = getFnOrSignal();
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
			if (prop === 'v' && !cleanup) {
				initialize();
			}
			return sourceSignal ? sourceSignal[prop] : target[prop];
		},
		set(target, prop, value) {
			if (prop === 'v') {
				if (sourceSignal) {
					sourceSignal.v = value;
				} else if (set) {
					set(value);
				} else {
					console.warn('Cannot set read-only computed signal');
					console.trace('Stack trace:');
				}
				return true;
			}
			return Reflect.set(target, prop, value);
		}
	});
}

/**
 * Creates a chainable computed builder with timing modifiers.
 * Allows composition like: computed.debounced(300).fetcher(source)
 * @param {number} delay - Delay in milliseconds
 * @returns {Object} Chainable object with fetcher and fromEvent methods
 */
computed.debounced = (delay) => {
	const builder = {
		/**
		 * Creates a debounced fetcher resource signal
		 * @param {any} url - The URL to fetch (can be a signal or static value)
		 * @param {any} [options={}] - Fetch options (can be a signal or static value)
		 * @returns {SignalNode} A debounced resource signal
		 */
		fetcher: (url, options = {}) => {
			const result = signal({ loading: false, error: undefined, data: undefined });
			let controller;
			let disposeEffect;

			// Backward compatibility: if options is a function, treat it as a custom fetcher
			const isCustomFetcher = typeof options === 'function';
			const fetcher = isCustomFetcher ? options : defaultFetcher;

			const fetchFunc = () => {
				controller = new AbortController();
				const localController = controller;
				result.v = { loading: true, error: undefined, data: undefined };

				const urlValue = isSignal(url) ? url.v : url;
				const optionsValue = isCustomFetcher ? url : (isSignal(options) ? options.v : options);
				const fetchOptions = isCustomFetcher ? optionsValue : { ...optionsValue, signal: localController.signal };

				const fetchPromise = isCustomFetcher
					? fetcher(fetchOptions)
					: fetcher(urlValue, fetchOptions);

				fetchPromise
					.then(value => { if (!localController.signal.aborted && controller === localController) { result.v = { loading: false, data: value, error: undefined }; } })
					.catch(err => { if (!localController.signal.aborted && controller === localController && err.name !== 'AbortError') { result.v = { loading: false, error: err, data: undefined }; } });
			};

			disposeEffect = effect.debounced(() => {
				fetchFunc();
				return () => controller?.abort();
			}, delay);

			result.onLastSubscriberRemoved(() => { if (disposeEffect) disposeEffect() });

			return new Proxy(result, {
				get(target, prop) {
					if (prop === 'refresh') {
						return () => { controller?.abort(); fetchFunc(); };
					}
					return target[prop];
				}
			});
		},

		/**
		 * Creates a debounced event signal
		 * @param {EventTarget} target - The event target
		 * @param {string} eventName - The event name to listen for
		 * @returns {SignalNode} A debounced event signal
		 */
		fromEvent: (target, eventName) => {
			const result = signal(null);
			let disposeEffect;

			result.onFirstSubscriber(() => {
				const tempSignal = signal(null);
				const handler = (event) => tempSignal.v = event;
				target.addEventListener(eventName, handler);

				disposeEffect = effect.debounced(() => {
					result.v = tempSignal.v;
				}, delay);

				const originalDispose = disposeEffect;
				disposeEffect = () => {
					target.removeEventListener(eventName, handler);
					originalDispose();
				};
			});

			result.onLastSubscriberRemoved(() => {
				if (disposeEffect) disposeEffect();
				target = null;
			});

			return result;
		}
	};

	// If called with a function as first arg (old API), use the function directly
	if (typeof delay === 'function') {
		const getFnOrSignal = delay;
		const delayMs = arguments[1];
		const set = arguments[2];
		return createDeferredComputed(getFnOrSignal, (fn) => effect.debounced(fn, delayMs), set);
	}

	return builder;
};

/**
 * Creates a chainable computed builder with throttling.
 * Allows composition like: computed.throttled(300).fetcher(source)
 * @param {number} delay - Minimum time in milliseconds between updates
 * @returns {Object} Chainable object with fetcher and fromEvent methods
 */
computed.throttled = (delay) => {
	const builder = {
		/**
		 * Creates a throttled fetcher resource signal
		 * @param {any} url - The URL to fetch (can be a signal or static value)
		 * @param {any} [options={}] - Fetch options (can be a signal or static value)
		 * @returns {SignalNode} A throttled resource signal
		 */
		fetcher: (url, options = {}) => {
			const result = signal({ loading: false, error: undefined, data: undefined });
			let controller;
			let disposeEffect;

			// Backward compatibility: if options is a function, treat it as a custom fetcher
			const isCustomFetcher = typeof options === 'function';
			const fetcher = isCustomFetcher ? options : defaultFetcher;

			const fetchFunc = () => {
				controller = new AbortController();
				const localController = controller;
				result.v = { loading: true, error: undefined, data: undefined };

				const urlValue = isSignal(url) ? url.v : url;
				const optionsValue = isCustomFetcher ? url : (isSignal(options) ? options.v : options);
				const fetchOptions = isCustomFetcher ? optionsValue : { ...optionsValue, signal: localController.signal };

				const fetchPromise = isCustomFetcher
					? fetcher(fetchOptions)
					: fetcher(urlValue, fetchOptions);

				fetchPromise
					.then(value => { if (!localController.signal.aborted && controller === localController) { result.v = { loading: false, data: value, error: undefined }; } })
					.catch(err => { if (!localController.signal.aborted && controller === localController && err.name !== 'AbortError') { result.v = { loading: false, error: err, data: undefined }; } });
			};

			disposeEffect = effect.throttled(() => {
				fetchFunc();
				return () => controller?.abort();
			}, delay);

			result.onLastSubscriberRemoved(() => { if (disposeEffect) disposeEffect() });

			return new Proxy(result, {
				get(target, prop) {
					if (prop === 'refresh') {
						return () => { controller?.abort(); fetchFunc(); };
					}
					return target[prop];
				}
			});
		},

		/**
		 * Creates a throttled event signal
		 * @param {EventTarget} target - The event target
		 * @param {string} eventName - The event name to listen for
		 * @returns {SignalNode} A throttled event signal
		 */
		fromEvent: (target, eventName) => {
			const result = signal(null);
			let disposeEffect;

			result.onFirstSubscriber(() => {
				const tempSignal = signal(null);
				const handler = (event) => tempSignal.v = event;
				target.addEventListener(eventName, handler);

				disposeEffect = effect.throttled(() => {
					result.v = tempSignal.v;
				}, delay);

				const originalDispose = disposeEffect;
				disposeEffect = () => {
					target.removeEventListener(eventName, handler);
					originalDispose();
				};
			});

			result.onLastSubscriberRemoved(() => {
				if (disposeEffect) disposeEffect();
				target = null;
			});

			return result;
		}
	};

	// If called with a function as first arg (old API), use the function directly
	if (typeof delay === 'function') {
		const getFnOrSignal = delay;
		const delayMs = arguments[1];
		const set = arguments[2];
		return createDeferredComputed(getFnOrSignal, (fn) => effect.throttled(fn, delayMs), set);
	}

	return builder;
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
		const previousEffect = currentEffect;
		currentEffect = effectContext;
		try {
			return onFulfilled(value);
		} finally {
			currentEffect = previousEffect;
		}
	} : undefined;

	const wrappedOnRejected = onRejected ? function(error) {
		const previousEffect = currentEffect;
		currentEffect = effectContext;
		try {
			return onRejected(error);
		} finally {
			currentEffect = previousEffect;
		}
	} : undefined;

	return originalThen.call(this, wrappedOnFulfilled, wrappedOnRejected);
};

Promise.prototype.catch = function(onRejected) {
	const effectContext = currentEffect;

	const wrappedOnRejected = onRejected ? function(error) {
		const previousEffect = currentEffect;
		currentEffect = effectContext;
		try {
			return onRejected(error);
		} finally {
			currentEffect = previousEffect;
		}
	} : undefined;

	return originalCatch.call(this, wrappedOnRejected);
};

Promise.prototype.finally = function(onFinally) {
	const effectContext = currentEffect;

	const wrappedOnFinally = onFinally ? function() {
		const previousEffect = currentEffect;
		currentEffect = effectContext;
		try {
			return onFinally();
		} finally {
			currentEffect = previousEffect;
		}
	} : undefined;

	return originalFinally.call(this, wrappedOnFinally);
};

/**
 * Wraps a promise to preserve the current effect context across async boundaries
 * @param {Promise} promise - The promise to wrap
 * @returns {Promise} A wrapped promise that restores the effect context
 * @deprecated This is no longer needed as Promise.prototype is now patched
 */
function trackAsync(promise) {
	return promise; // No-op since Promise.prototype is patched
}

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

export { signal, signal as state, computed, effect, isSignal, trackAsync, untrack };