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
    const subscribers = new Set();
    let value = initialValue;
    let onFirstSubscriber = null;
    let onLastSubscriberRemoved = null;
    const readBy = new WeakSet(); // Track which effects have read this signal
    const readWriteCycles = new Map(); // Track read-write cycles by effect

    const signalObj = {
        get v() {
            if (currentEffect) {
                // Track that this effect has read from this signal
                readBy.add(currentEffect);

                if (!subscribers.has(currentEffect)) {
                    if (subscribers.size === 0 && onFirstSubscriber) {
                        onFirstSubscriber();
                    }
                    subscribers.add(currentEffect);
                    currentEffect.dependenciesCleanups.add(() => {
                        subscribers.delete(currentEffect);
                        if (subscribers.size === 0 && onLastSubscriberRemoved) {
                            onLastSubscriberRemoved();
                        }
                    });
                    currentEffect.dependencies.add(signalObj);
                }
            }
            return value;
        },
        set v(newValue) {
            // Check if current effect also read this signal
            if (currentEffect && readBy.has(currentEffect)) {
                // Get or initialize cycle counter for this effect
                const cycleCount = (readWriteCycles.get(currentEffect) || 0) + 1;
                readWriteCycles.set(currentEffect, cycleCount);
                
                // If we've hit a threshold of successive read-write cycles, block the update
                if (cycleCount > 10) { // Arbitrary threshold
                    console.error('Stopped effect execution because of a potential infinite loop: Effect is repeatedly reading and writing to the same signal');
                    return; // Prevent the update to stop the infinite loop
                }
            }

            if (equals === false || !equals(value, newValue)) {
                value = newValue;
                queueEffects(subscribers);
            }
        },
        onFirstSubscriber(cb) {
            onFirstSubscriber = cb;
            // If we already have subscribers and this is the first time setting the callback,
            // we should call it immediately
            if (subscribers.size > 0 && onFirstSubscriber) {
                onFirstSubscriber();
            }
        },
        onLastSubscriberRemoved(cb) {
            onLastSubscriberRemoved = cb;
        }
    };

    return signalObj;
}

// Computed Values Implementation
function computed(computeFn) {
	const s = signal(undefined);
	let cleanup = null;

	// Initialize the computed value immediately
	const initialize = () => {
		if (!cleanup) {
			cleanup = effect(() => {
				s.v = computeFn();
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

	return { get v() { return s.v; } };
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

			fetcher(sourceValue)
				.then(value => { if (!controller.signal.aborted) { result.loading.v = false; result.v = value } })
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
	}

	const cleanup = effect(() => {
		if (!dependencies) {
			fn();
			if (currentEffect) dependencies = new Set(currentEffect.dependencies);
			innerEffect = currentEffect;

			//console.log('----->dependencies:', dependencies);
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
		timeoutId = setTimeout(() => { clearInterval(IntervalId); IntervalId = null }, delay);
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
}

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

function bound(sig) {
	let boundSignal = sig;
	return {
		get v() {
			return boundSignal.v;
		},
		set v(newValue) {
			boundSignal.v = newValue;
		},
		onFirstSubscriber(cb) {
			boundSignal.onFirstSubscriber(cb);
		},
		onLastSubscriberRemoved(cb) {
			boundSignal.onLastSubscriberRemoved(cb);
		},
		bind(sig) {
			boundSignal = sig;
		}
	};
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

export { signal, computed, effect, bound };