import {wrapInContext} from './utils.js';

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

// Core Signal Implementation
/**
 * 
 * @param {*} initialValue - initial value of the signal
 * @returns - signal object with get and set properties
 */
function signal(initialValue) {
	class SignalNode {
		#value;
		#subscribers = new Set();
		#onFirstSubscriber = null
		#onLastSubscriberRemoved = null
		#readBy = new WeakSet();
		#readWriteCycles = new Map();

		constructor(initialValue) {
			this.#setValue(initialValue);
		}

		#setValue(val) {
			if (isObject(val) && (isArray(val) || isPlainObject(val))) {
				if (isArray(val)) {
					// If current value isn't an array, create one
					if (!isArray(this.#value)) {
						this.#value = [];
					}

					// Preserve existing signals where possible
					const newArray = [];
					for (let i = 0; i < val.length; i++) {
						const item = val[i];

						if (isObject(item)) {
							// Try to find a matching object in the existing array
							const existingSignal = i < this.#value.length && isSignal(this.#value[i]) ?
								this.#value[i] : null;

							if (existingSignal) {
								// Update existing signal
								existingSignal.v = item;
								newArray[i] = existingSignal;
							} else {
								// Create new signal (with no parent connection)
								const nestedSignal = signal(item);
								newArray[i] = nestedSignal;
							}
						} else {
							newArray[i] = item; // Primitive value
						}
					}
					this.#value = newArray;
				} else {
					// For objects, preserve existing signals where possible
					const newObj = {};
					const existingObj = isObject(this.#value) && !isArray(this.#value)
						? this.#value
						: {};

					// First, process all properties in the new value
					for (const key in val) {
						if (Object.prototype.hasOwnProperty.call(val, key)) {
							const propValue = val[key];

							// Check if we have an existing signal for this property
							const existingSignal = key in existingObj && isSignal(existingObj[key]) ?
								existingObj[key] : null;

							if (existingSignal) {
								// Update existing signal
								existingSignal.v = propValue;
								newObj[key] = existingSignal;
							} else {
								// Create new signal (without parent connection)
								const nestedSignal = signal(propValue);
								newObj[key] = nestedSignal;
							}
						}
					}

					// Only create a new object if the current value isn't already an object
					if (typeof this.#value !== 'object' || this.#value === null || isArray(this.#value)) {
						this.#value = newObj;
					} else {
						// Update the existing object with new properties
						for (const key in newObj) {
							this.#value[key] = newObj[key];
						}
					}
				}
			} else {
				this.#value = val;
			}
		}

		get v() {
			// Unwrap nested signals when returning the value
			return this.#unwrapValue(this.#value);
		}

		subscribe () {
			if (currentEffect) {
				// Track that this effect has read from this signal
				this.#readBy.add(currentEffect);

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

		// Helper method to unwrap signals recursively
		#unwrapValue(value) {
			// If not an object or null, return as is
			if (!(isArray(value) || isPlainObject(value))) {
				return value;
			}

			// Handle arrays
			if (isArray(value)) {
				return value.map(item => {
					// If item is a signal, get its value and unwrap
					if (isSignal(item)) {
						return this.#unwrapValue(item.v);
					}
					return this.#unwrapValue(item);
				});
			}

			// For objects, recursively unwrap each property
			const result = {};
			for (const key in value) {
				if (Object.prototype.hasOwnProperty.call(value, key)) {
					const prop = value[key];
					if (isSignal(prop)) {
						result[key] = this.#unwrapValue(prop.v);
					} else {
						result[key] = this.#unwrapValue(prop);
					}
				}
			}

			return result;
		}

		set v(newValue) {
			// Check if current effect also read this signal
			if (currentEffect && this.#readBy.has(currentEffect)) {
				// Get or initialize cycle counter for this effect
				const cycleCount = (this.#readWriteCycles.get(currentEffect) || 0) + 1;
				this.#readWriteCycles.set(currentEffect, cycleCount);

				// If we've hit a threshold of successive read-write cycles, block the update
				if (cycleCount > 10) { // Arbitrary threshold
					console.error('Stopped effect execution because of a potential infinite loop: Effect is repeatedly reading and writing to the same signal');
					return; // Prevent the update to stop the infinite loop
				}
				
				// Clean up old cycles periodically
				if (this.#readWriteCycles.size > 100) {
					// Clear cycles for effects that no longer exist
					for (const [effect] of this.#readWriteCycles) {
						if (!this.#subscribers.has(effect)) {
							this.#readWriteCycles.delete(effect);
						}
					}
				}
			}

			// Only trigger updates for this specific level, not for nested changes
			const oldValue = this.#value;

			// For arrays, consider length changes as changes to this signal
			// For objects, only consider direct property additions/removals
			const hasChanged = oldValue !== newValue 
				|| (isArray(newValue) && isArray(oldValue) && newValue.length !== oldValue.length)
				|| (isObject(newValue) && isObject(oldValue) && !isArray(newValue) && !isArray(oldValue) 
					&& !objectsHaveSameKeys(oldValue, newValue));

			if (hasChanged) {
				this.#setValue(newValue); // This updates #value with processed nested signals
				queueEffects(this.#subscribers);
			}
		}

		notifyChange() {
			// Only notify direct subscribers, do not propagate up the tree
			queueEffects(this.#subscribers);
		}

		onFirstSubscriber(cb) {
			this.#onFirstSubscriber = cb;
			// If we already have subscribers and this is the first time setting the callback,
			// we should call it immediately
			if (this.#subscribers.size > 0 && this.#onFirstSubscriber) {
				this.#onFirstSubscriber();
			}
			return proxySignal; // Return the proxy for chaining
		}

		onLastSubscriberRemoved(cb) {
			this.#onLastSubscriberRemoved = cb;
			return proxySignal; // Return the proxy for chaining
		}

		getSubscribers() {
			return this.#subscribers;
		}

		getValue() {
			return this.#value; // Returns the internal structure with signals intact
		}

		// Add to SignalNode class
		isSame(otherSignal) {
			// Compare the actual SignalNode instances, not the proxies
			return this === (otherSignal && isSignal(otherSignal) ?
				otherSignal.getSelf() : otherSignal);
		}
	};

	const signalNode = new SignalNode(initialValue);

	const proxySignal = new Proxy(signalNode, {
		get(target, prop) {
			// Handle core signal methods
			if (prop === 'v') {target.subscribe(); return target.v;}
			if (prop === 'onFirstSubscriber') return target.onFirstSubscriber.bind(target);
			if (prop === 'onLastSubscriberRemoved') return target.onLastSubscriberRemoved.bind(target);
			if (prop === 'getValue') return target.getValue.bind(target);
			if (prop === 'isSame') return (other) => target.isSame(other);
			if (prop === 'getSelf') return () => target;
			if (prop === 'val') return () => target.val();

			// For other properties, access the underlying value
			const internalValue = target.getValue ? target.getValue() : undefined;

			// If value is an object/array, handle property access based on the internal signal structure
			if (isObject(internalValue)) {
				// Special handling for array methods
				if (isArray(internalValue) && typeof Array.prototype[prop] === 'function') {
					// Combine similar methods into arrays
					const mutatingMethods = ['push', 'pop', 'shift', 'unshift', 'splice', 'sort', 'reverse'];
					const nonMutatingMethods = ['map', 'filter', 'find', 'forEach', 'some', 'every', 'reduce', 'reduceRight'];

					if (mutatingMethods.includes(prop)) {
						return function (...args) {
							// For methods that add elements (push, unshift, splice)
							if (prop === 'push' || prop === 'unshift' || (prop === 'splice' && args.length > 2)) {
								// Wrap new objects in signals
								const startIdx = prop === 'splice' ? 2 : 0;
								for (let i = startIdx; i < args.length; i++) {
									if (isObject(args[i]) && !isSignal(args[i])) {
										args[i] = signal(args[i]);
									}
								}
							}

							// Apply the method directly to the internal array
							const result = Array.prototype[prop].apply(internalValue, args);

							// Notify subscribers about the change to this array's structure
							target.notifyChange();

							return result;
						};
					}
					if (nonMutatingMethods.includes(prop)) {
						return function (...args) {
							// For methods with callbacks (map, filter, find, etc.)
							if (typeof args[0] === 'function') {
								const originalCallback = args[0];

								// Replace the callback to handle signal objects
								args[0] = function (item, index, array) {
									// Call the original callback with the items directly
									return originalCallback(item, index, array);
								};
							}

							// Call the original method
							const result = Array.prototype[prop].apply(internalValue, args);
							return result;
						};
					}
				}

				// Handle numeric array indices
				if (isArray(internalValue) && !isNaN(Number(prop))) {
					const index = Number(prop);
					if (index < internalValue.length) {
						return internalValue[index]; // Return the signal, not the unwrapped value
					}
				}

				// Return the nested signal for object properties
				if (prop in internalValue) {
					return internalValue[prop]; // Return the signal, not the unwrapped value
				}
			}

			return undefined;
		},

		set(target, prop, value) {
			// Handle setting the main value or callbacks
			if (prop === 'v') {
				target.v = value;
				return true;
			}

			if (prop === 'onFirstSubscriber' || prop === 'onLastSubscriberRemoved') {
				target[prop](value);
				return true;
			}

			// Handle dynamic property assignment
			const internalValue = target.getValue();
			if (isObject(internalValue)) {
				// If property exists and is a signal, update its value
				if (prop in internalValue && isSignal(internalValue[prop])) {
					internalValue[prop].v = value;
				} else {
					// Create a new signal for this property
					internalValue[prop] = isSignal(value) ? value : signal(value);
                    
					// Important: Only notify about direct changes to this object's structure
					// Don't notify for changes to existing properties' values
					queueEffects(target.getSubscribers());
				}
				return true;
			}

			return true;
		}
	});

	return proxySignal;
}

const isSignal = (obj) => isObject(obj) && 'v' in obj;

// Computed Values Implementation
function computed(computeFn) {
	if (isSignal(computeFn)) return computeFn;

	const s = signal(undefined);
	let cleanup = null;
	let sourceSignal;

	// Initialize the computed value immediately
	const initialize = () => {
		if (!cleanup) {
			cleanup = effect(() => {
				const newValue = computeFn();
				if (isSignal(newValue)) {
					sourceSignal = newValue;
					s.v = newValue.v;
				}
				else s.v = newValue;
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

	result.fetch = () => { controller?.abort(); fetchFunc(); };

	let disposeEffect;

	//result.onFirstSubscriber(() => {
		disposeEffect = effect(() => {
			fetchFunc();

			// Cleanup function that aborts the request
			return () => controller?.abort();
		});
	//});

	result.onLastSubscriberRemoved(() => { if (disposeEffect) disposeEffect() });

	return result;
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