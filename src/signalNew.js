import { wrapInContext } from './utils.js';

let currentEffect = null;
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

const signalSymbol = Symbol('signal');
const signalIdentifier = Symbol('signalIdentifier'); // Symbol used as property key to identify signals
const isSignal = (value) => value && value?.[signalIdentifier] === signalSymbol;
const isSignalPrimitive = (value) => value && value.isSignalPrimitive === signalSymbol;

// Internal method symbols - these won't conflict with user properties
const getSelf = Symbol('getSelf');
const mergeWith = Symbol('mergeWith');
const addParent = Symbol('addParent');
const clear = Symbol('clear'); // used to clear the signal
const onFirstSubscriber = Symbol('onFirstSubscriber');
const onFirstDescendantSubscriber = Symbol('onFirstDescendantSubscriber');
const onLastSubscriberRemoved = Symbol('onLastSubscriberRemoved');

const singleUse = (callback) => {
    let called = false;
    return () => {
        if (!called) {
            called = true;
            callback();
        }
    };
};

class SignalPrimitive {
    #value = null;
    #unrealizedProperties = {};
    #parents = new Set();
    #subscribers = new Set();
    #onFirstSubscriber = new Set();
    #onLastSubscriberRemoved = new Set();
    #onFirstDescendantSubscriber = new Set();
    #onLastDescendantSubscriberRemoved = new Set();
    #hasSubscribers = false;

    #readBy = new WeakSet();
    #readWriteCycles = new Map();

    isSignalPrimitive = signalSymbol;

    constructor(value) {
        this.value = value;
    }

    #queueEffects() {
        for (const effect of this.#subscribers) {
            // if the effect is already pending, since pendingEffects is a Set, it will not be added again
            pendingEffects.add(effect);
            if (!isFlushing) {
                isFlushing = true;
                queueMicrotask(SignalPrimitive.#flushEffects);
            }
        }
    }

    static #flushEffects() {
        for (const effect of pendingEffects) {
            effect();
        }
        pendingEffects.clear();
        isFlushing = false;
    };

    clear() {
        this.#value = null;
        this.#unrealizedProperties = {};
        this.#parents.clear();
        this.#subscribers.clear();
        this.#onFirstSubscriber.clear();
        this.#onLastSubscriberRemoved.clear();
        this.#onFirstDescendantSubscriber.clear();
        this.#onLastDescendantSubscriberRemoved.clear();
        // in the future we may need to collect cleanup functions for subscriber effects
    }

    set value(newValue) {
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
            this.#setValue(newValue);
        }
    }

    #setValue(value) {
        const singleUseQueueEffects = singleUse(this.#queueEffects.bind(this));
        if (isObject(value)) {
            if (isPlainObject(value)) {
                // Initialize #value as object if needed
                if (!isObject(this.#value) || isArray(this.#value)) {
                    this.#value = {};
                }
                
                try {
                    for (const key in value) {
                        this.realizeProperty(key);
                    }
                } catch (error) {
                    // If an error is thrown, it means the value is not an object
                    this.#value = {};
                }
                
                for (const key in value) {
                    if (this.#value && key in this.#value && isSignal(this.#value[key])) { // if the key already exists in the current value, we update it
                        if (isSignal(value[key])) {
                            if (this.isSame(value[key])) continue;
                            value[key][mergeWith](this);
                            value[key].v = value[key].v;
                        } else this.#value[key].v = signal(value[key]);
                    } else { // if the key does not exist in the current value, we create a new signal for it
                        this.#value[key] = isSignal(value[key]) ? value[key] : signal(value[key]);
                        this.#value[key][addParent](this);
                        this.#value[key].onFirstDescendantSubscriber(singleUseQueueEffects);
                    }
                }
                
                for (const key in this.#value) { // we check if the key exists in the new value, if not we remove it from the current value
                    if (!(key in value)) {
                        this.#value[key][clear](); // reset the signal for the key
                        delete this.#value[key];
                    }
                }
                
                singleUseQueueEffects();
            }
            else if (isArray(value)) {
                // Initialize #value as array if needed
                if (!isArray(this.#value)) {
                    this.#value = [];
                }
                
                try {
                    for (let i = 0; i < value.length; i++) {
                        this.realizeProperty(i);
                    }
                } catch (error) {
                    // If an error is thrown, it means the value is not an array
                    this.#value = [];
                }
                
                // we make sure the current value array has the same length as the new value array otherwise we will trim it or add new elements
                this.#value.length = value.length;

                for (let i = 0; i < this.#value.length; i++) {
                    if (isSignal(this.#value[i])) {
                        if (isSignal(value[i])) {
                            if (this.isSame(value[i])) continue; // if the value is the same signal, we don't need to update it.
                            value[i][mergeWith](this.#value[i]); // merge the two signals
                            value[i].v = value[i].v; // this will update the value of the signal
                        } else {
                            this.#value[i].v = signal(value[i]);
                            this.#value[i].onFirstDescendantSubscriber(singleUseQueueEffects);
                        }
                    } else {
                        this.#value[i] = isSignal(value[i]) ? value[i] : signal(value[i]);
                        this.#value[i][addParent](this);
                        this.#value[i].onFirstDescendantSubscriber(singleUseQueueEffects);
                    }
                }
                
                singleUseQueueEffects();
            } else {
                // if the value is not an object or an array, we just set the value
                this.#value = value;
                singleUseQueueEffects();
            }
        } else {
            // Handle non-object values
            this.#value = value;
            singleUseQueueEffects();
        }
    }

    subscribe() {
        if (currentEffect) {
            this.#readBy.add(currentEffect);

            this.#subscribers.add(currentEffect);
            this.#hasSubscribers = true;

            this.#onFirstSubscriber.forEach(callback => callback());
            this.#onFirstDescendantSubscriber.forEach(callback => callback());
            this.#onFirstSubscriber.clear();
            this.#onFirstDescendantSubscriber.clear();

            currentEffect.dependenciesCleanups.add(() => {
                this.#subscribers.delete(currentEffect);
                if (this.#subscribers.size === 0) {
                    this.#onLastSubscriberRemoved.forEach(callback => callback());
                    this.#onLastSubscriberRemoved.clear();
                }
            });

            for (const parent of this.#parents) {
                parent.subscribe();
            }
        }
    }

    getValue() {
        return this.#value;
    }

    newUnrealizedProperty(prop) { //used to add a signal object that has not been created yet but has been requested
        this.#unrealizedProperties[prop] = signal(undefined);
    }

    hasUnrealizedProperty(prop) {
        return prop in this.#unrealizedProperties;
    }

    realizeProperty(prop) {
        if (!this.hasUnrealizedProperty(prop)) return;
        if (this.#value === undefined) this.#value = {};
        if (!isObject(this.#value)) {
            throw new Error('Invalid value when trying to realize property');
        }
        this.#value[prop] = this.#unrealizedProperties[prop];
        delete this.#unrealizedProperties[prop];
        for (const parent of this.#parents) {
            parent.searchAndRealizeProperty(this);
        }
    }

    searchAndRealizeProperty(signal) {
        for (const key in this.#unrealizedProperties) {
            if (this.#unrealizedProperties[key] === signal) {
                this.realizeProperty(key);
                return;
            }
        }
    }

    addUnrealizedProperty(prop) {
        if (!this.hasUnrealizedProperty(prop)) {
            this.#unrealizedProperties[prop] = signal(undefined);
        }
        return this.#unrealizedProperties[prop];
    }

    addFirstSubscriberCallback(callback) {
        if (this.#hasSubscribers) {
            callback();
            return;
        }
        this.#onFirstSubscriber.add(callback);
    }

    addFirstDescendantSubscriberCallback(callback) {
        if (this.#hasSubscribers) {
            callback();
            return;
        }
        this.#onFirstDescendantSubscriber.add(callback);
        if (isObject(this.#value)) {
            for (const prop in this.#value) {
                this.#value[prop].onFirstDescendantSubscriber(callback);
            }
        }
    }

    addLastSubscriberRemovedCallback(callback) {
        this.#onLastSubscriberRemoved.add(callback);
    }

    addParent(signal) {
        if (!isSignalPrimitive(signal)) {
            throw new Error('Parent must be a SignalPrimitive');
        }
        this.#parents.add(signal);
    }

    isSame(otherSignal) {
        return this === otherSignal?.[getSelf]()
    }

    getInternalData() {
        return {
            value: this.#value,
            unrealizedProperties: this.#unrealizedProperties,
            parents: Array.from(this.#parents),
            subscribers: Array.from(this.#subscribers),
            onFirstSubscriber: Array.from(this.#onFirstSubscriber),
            onLastSubscriberRemoved: Array.from(this.#onLastSubscriberRemoved),
            onFirstDescendantSubscriber: Array.from(this.#onFirstDescendantSubscriber),
            onLastDescendantSubscriberRemoved: Array.from(this.#onLastDescendantSubscriberRemoved)
        };
    }

    mergeInternalData(otherSignal) {
        const otherData = otherSignal.getInternalData();
        this.#value = otherData.value;
        this.#unrealizedProperties = { ...this.#unrealizedProperties, ...otherData.unrealizedProperties };
        this.#parents = new Set([...this.#parents, ...otherData.parents]);
        this.#subscribers = new Set([...this.#subscribers, ...otherData.subscribers]);
        this.#onFirstSubscriber = new Set([...this.#onFirstSubscriber, ...otherData.onFirstSubscriber]);
        this.#onLastSubscriberRemoved = new Set([...this.#onLastSubscriberRemoved, ...otherData.onLastSubscriberRemoved]);
        this.#onFirstDescendantSubscriber = new Set([...this.#onFirstDescendantSubscriber, ...otherData.onFirstDescendantSubscriber]);
        this.#onLastDescendantSubscriberRemoved = new Set([...this.#onLastDescendantSubscriberRemoved, ...otherData.onLastDescendantSubscriberRemoved]);

        // Clear the other signal to avoid memory leaks
        otherSignal.clear();
    }

    get value() { // get unwrapped value
        if (isPlainObject(this.#value)) {
            return Object.fromEntries(Object.entries(this.#value).map(([key, signal]) => [key, signal.v]));
        }
        if (isArray(this.#value)) {
            return this.#value.map(item => item.v);
        }
        return this.#value;
    }

    get internalValue() { // get internal value, which may be a signal or a primitive value
        return this.#value;
    }

    get self() {
        return this;
    }
}

const mutatingMethods = ['push', 'pop', 'shift', 'unshift', 'splice', 'sort', 'reverse'];
const nonMutatingMethods = ['map', 'filter', 'find', 'forEach', 'some', 'every', 'reduce', 'reduceRight'];

const signal = (value) => {
    if (isSignal(value)) return value;

    let mergedWith = null;

    return new Proxy(new SignalPrimitive(value), {
        set(target, prop, newValue) {
            if (isSignal(mergedWith)) {
                target = mergedWith;
            }

            if (prop === 'v') {
                target.value = newValue;
                return true;
            }

            const targetValue = target.value;
            if (isObject(targetValue)) {
                targetValue[prop] = newValue;
                target.value = targetValue;
                return true;
            }
            
            // Return true for any other property assignment
            return true;
        },

        get(target, prop) {
            if (isSignal(mergedWith)) {
                target = mergedWith;
            }

            if (prop === 'v') {
                target.subscribe();
                return target.value;
            }
            if (prop === 'isSame') return (other) => target.isSame(other);
            if (prop === 'onFirstSubscriber') return (callback) => target.addFirstSubscriberCallback(callback);
            if (prop === 'onFirstDescendantSubscriber') return (callback) => target.addFirstDescendantSubscriberCallback(callback);
            if (prop === 'onLastSubscriberRemoved') return (callback) => target.addLastSubscriberRemovedCallback(callback);

            if (prop === signalIdentifier) return target.isSignalPrimitive;
            if (prop === getSelf) return () => target.self;
            if (prop === addParent) return (parent) => target.addParent(parent);
            if (prop === clear) return () => target.clear();
            if (prop === mergeWith) return (other) => {
                if (!isSignalPrimitive(other)) {
                    throw new Error('Argument must be a SignalPrimitive');
                }
                target.mergeInternalData(other);
                mergedWith = other;
            };

            const internalValue = target.internalValue;

            if (isArray(internalValue)) {
                if (isNaN(Number(prop))) {
                    if (mutatingMethods.includes(prop)) {
                        return (...args) => {
                            const result = internalValue[prop](...args);
                            target.value = internalValue; // update the value after mutating
                            return result;
                        };
                    } else if (nonMutatingMethods.includes(prop)) {
                        return (...args) => {
                            return internalValue[prop](...args);
                        };
                    }
                } else { // get the value of the signal
                    const index = Number(prop);
                    if (index >= 0 && index < internalValue.length) {
                        return internalValue[index];
                    } else {
                        return target.addUnrealizedProperty(index);
                    }
                }
            }

            if (isPlainObject(internalValue)) {
                if (prop in internalValue) {
                    return internalValue[prop];
                } else {
                    return target.addUnrealizedProperty(prop);
                }
            }

            return target.addUnrealizedProperty(prop);
        }
    });
}

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

function cleanupDependencies(effectFn) {
    effectFn.dependenciesCleanups.forEach(cleanup => cleanup());
    effectFn.dependenciesCleanups.clear();
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

export { signal, computed, effect, isSignal };