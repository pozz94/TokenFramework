// signal.js
let currentEffect = null;  // Explicitly initialize as null
let pendingEffects = new Set();
let isFlushing = false;

// Core Signal Implementation
/**
 * 
 * @param {*} initialValue - initial value of the signal
 * @param {*} equals - function to compare if the value has changed.
 * Default is strict equality but can be set to false to disable the check so that any change triggers an update 
 * or a custom function can be passed in for more advanced use cases.
 * @returns - signal object with get and set properties
 */
function signal(initialValue, equals = (a, b) => a === b) {
	class SignalNode {
		#value;
		#equals;
		#subscribers = new Set();
		#onFirstSubscriber = null
		#onLastSubscriberRemoved = null
		#readBy = new WeakSet();
		#readWriteCycles = new Map();
		#customProps = new Map();
		#parent = null;
		#parentKey = null;

		constructor(initialValue, equals) {
			this.#equals = equals;
			this.#setValue(initialValue);
		}

		#setValue(val) {
			if (typeof val === 'object' && val !== null && (Array.isArray(val) || Object.getPrototypeOf(val) === Object.prototype)) {
				if (Array.isArray(val)) {
					// If current value isn't an array, create one
					if (!Array.isArray(this.#value)) {
						this.#value = [];
					}

					// Preserve existing signals where possible
					const newArray = [];
					for (let i = 0; i < val.length; i++) {
						const item = val[i];

						if (typeof item === 'object' && item !== null) {
							// Try to find a matching object in the existing array
							const existingSignal = i < this.#value.length && isSignal(this.#value[i]) ?
								this.#value[i] : null;

							if (existingSignal) {
								// Update existing signal
								existingSignal.v = item;
								newArray[i] = existingSignal;
							} else {
								// Create new signal
								const nestedSignal = signal(item, this.#equals);
								nestedSignal._setParent(this, i);
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
					const existingObj = typeof this.#value === 'object' && this.#value !== null && !Array.isArray(this.#value) ?
						this.#value : {};

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
								// Create new signal
								const nestedSignal = signal(propValue, this.#equals);
								nestedSignal._setParent(this, key);
								newObj[key] = nestedSignal;
							}
						}
					}

					this.#value = newObj;
				}
			} else {
				this.#value = val;
			}
		}

		_setParent(parent, key) {
			//this.#parent = parent;
			//this.#parentKey = key;
		}

		get v() {
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

			// Unwrap nested signals when returning the value
			return this.#unwrapValue(this.#value);
		}

		// Helper method to unwrap signals recursively
		#unwrapValue(value) {
			// If not an object or null, return as is
			if (typeof value !== 'object' || value === null || (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype)) {
				return value;
			}

			// Handle arrays
			if (Array.isArray(value)) {
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
			}

			const oldValue = this.#value;
			this.#setValue(newValue); // This updates #value with processed nested signals

			if (this.#equals === false || !this.#equals(oldValue, this.#value)) {
				// Notify direct subscribers
				queueEffects(this.#subscribers);

				// Bubble changes upward to parent signals
				if (this.#parent) {
					// This will trigger parent effects without changing the parent's value
					this.#parent.notifyChange();
				}
			}
		}
		notifyChange() {
			queueEffects(this.#subscribers);

			// Continue propagation upward
			if (this.#parent) {
				//this.#parent.notifyChange();
			}
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

		// Methods for custom properties
		getCustomProp(key) {
			return this.#customProps.get(key);
		}

		setCustomProp(key, value) {
			this.#customProps.set(key, value);
		}

		hasCustomProp(key) {
			return this.#customProps.has(key);
		}

		getSubscribers() {
			return this.#subscribers;
		}

		_getValue() {
			return this.#value; // Returns the internal structure with signals intact
		}

		// Add to SignalNode class
		isSame(otherSignal) {
			// Compare the actual SignalNode instances, not the proxies
			return this === (otherSignal && isSignal(otherSignal) ?
				otherSignal._getInternalNode() : otherSignal);
		}

		_getInternalNode() {
			return this;
		}
	};

	const signalNode = new SignalNode(initialValue, equals);

	const proxySignal = new Proxy(signalNode, {
		get(target, prop) {
			// Handle core signal methods
			if (prop === 'v') return target.v;
			if (prop === 'onFirstSubscriber') return target.onFirstSubscriber.bind(target);
			if (prop === 'onLastSubscriberRemoved') return target.onLastSubscriberRemoved.bind(target);
			if (prop === '_setParent') return target._setParent.bind(target);
			if (prop === '_getValue') return target._getValue.bind(target);
			if (prop === 'isSame') return (other) => target.isSame(other);
			if (prop === '_getInternalNode') return () => target;

			// Check for custom properties directly on the signal
			if (target.hasCustomProp(prop)) {
				return target.getCustomProp(prop);
			}

			// For other properties, access the underlying value
			const internalValue = target._getValue ? target._getValue() : undefined;

			// If value is an object/array, handle property access based on the internal signal structure
			if (typeof internalValue === 'object' && internalValue !== null) {
				// Special handling for array methods
				if (Array.isArray(internalValue) && typeof Array.prototype[prop] === 'function' &&
					['push', 'pop', 'shift', 'unshift', 'splice', 'sort', 'reverse'].includes(prop)) {
					return function (...args) {
						// For methods that add elements (push, unshift, splice)
						if (prop === 'push' || prop === 'unshift' || (prop === 'splice' && args.length > 2)) {
							// Wrap new objects in signals
							const startIdx = prop === 'splice' ? 2 : 0;
							for (let i = startIdx; i < args.length; i++) {
								if (typeof args[i] === 'object' && args[i] !== null && !isSignal(args[i])) {
									args[i] = signal(args[i]);
								}
							}
						}

						// Apply the method directly to the internal array
						const result = Array.prototype[prop].apply(internalValue, args);

						// Just notify subscribers about the change 
						target.notifyChange();

						return result;
					};
				}

				// Special handling for non-mutating array methods
				if (Array.isArray(internalValue) && typeof Array.prototype[prop] === 'function' &&
					['map', 'filter', 'find', 'forEach', 'some', 'every', 'reduce', 'reduceRight'].includes(prop)) {
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

				// Handle numeric array indices
				if (Array.isArray(internalValue) && !isNaN(Number(prop))) {
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

			// Store custom properties directly on the signal
			if (prop !== 'v' && prop !== 'onFirstSubscriber' && prop !== 'onLastSubscriberRemoved') {
				target.setCustomProp(prop, value);
				return true;
			}

			return true;
		}
	});

	return proxySignal;
}

const isSignal = (obj) => typeof obj === 'object' && obj !== null && 'v' in obj;

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

	return { get v() { return sourceSignal ? sourceSignal.v : s.v }, set v(newValue) { if (sourceSignal) sourceSignal.v = newValue } };
}

const defaultFetcher = async (input) => {
	// Handle request config objects
	const { url, method = 'GET', body, headers = {}, signal } = input;
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

computed.fromResource = (source, fetcher = defaultFetcher) => {
	const result = signal(undefined);
	result.loading = signal(false);
	result.error = signal(undefined);
	result.data = result;

	//const result = signal({ loading: false, error: undefined, data: undefined });

	let disposeEffect;

	result.onFirstSubscriber(() => {
		disposeEffect = effect(() => {
			const controller = new AbortController();
			//const sourceValue = typeof source === 'string' ? source : source.v;
			const sourceValue = {
				...typeof source?.v === 'object' ? source.v : { url: typeof source?.v === 'string' ? source.v : typeof source === 'string' ? source : '' },
				signal: controller.signal
			}
			result.loading.v = true;
			result.error.v = undefined;
			result.v = undefined;

			//result.v = { loading: true, error: undefined, data: undefined };

			fetcher(sourceValue)
				.then(value => { if (!controller.signal.aborted) { result.loading.v = false; result.data.v = value } })
				.catch(err => { if (!controller.signal.aborted && err.name !== 'AbortError') { result.loading.v = false; result.error.v = err } })
			//.finally(() => { if (!controller.signal.aborted) result.loading.v = false });

			// Cleanup function that aborts the request
			return () => controller.abort();
		});
	});

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
		// Run any existing cleanup from previous run
		if (cleanupFromFn && typeof cleanupFromFn === 'function') {
			cleanupFromFn();
		}

		cleanupDependencies(effectFn);
		const previousEffect = currentEffect;  // Save previous effect
		currentEffect = effectFn;
		try {
			const oldEffect = globalThis?.effect;
			globalThis.effect = effect;
			cleanupFromFn = fn(); // Store the cleanup function returned by fn
			globalThis.effect = oldEffect;
			return cleanupFromFn;
		} finally {
			currentEffect = previousEffect;  // Restore previous effect
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
		const oldEffect = globalThis?.effect;
		globalThis.effect = effect;
		fn();
		globalThis.effect = oldEffect;
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

effect.untrack = function (fn) {
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