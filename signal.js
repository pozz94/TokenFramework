// signal.js
let currentEffect = null;  // Explicitly initialize as null
let pendingEffects = new Set();
let isFlushing = false;

// Core Signal Implementation
function signal(initialValue) {
	const subscribers = new Set();
	let value = initialValue;
	let onFirstSubscriber = null;
	let onLastSubscriberRemoved = null;

	const signalObj = {
		get v() {
			// Only track if we have a current effect
			//console.log('get signal:', this.id);
			if (currentEffect) {
				if (!subscribers.has(currentEffect)) {
					if (subscribers.size === 0 && onFirstSubscriber) {
						onFirstSubscriber();
					}
					subscribers.add(currentEffect);
					currentEffect.dependencies.add(() => {
						subscribers.delete(currentEffect);
						if (subscribers.size === 0 && onLastSubscriberRemoved) {
							onLastSubscriberRemoved();
						}
					});
				}
			}
			return value;
		},
		set v(newValue) {
			if (newValue !== value) {
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
	let disposeEffect = null;

	// Initialize the computed value immediately
	const initialize = () => {
		if (!disposeEffect) {
			disposeEffect = effect(() => {
				s.v = computeFn();
			});
		}
	};

	s.onFirstSubscriber(() => {
		initialize();
	});

	s.onLastSubscriberRemoved(() => {
		if (disposeEffect) {
			disposeEffect();
			disposeEffect = null;
		}
	});

	// Initialize immediately to handle the first access
	initialize();

	return { get v() { return s.v; } };
}

// Effect Implementation
//jsdoc warning that effect must be disposed of after use outside components

/**
 * @param {Function} fn - function to be executed as an effect
 * @returns {Function} cleanup function to remove all dependencies and subscribers from the effect
 * @description
 * Effect is a function that takes a function as an argument and returns a cleanup function.
 * The cleanup function is used to remove all dependencies and subscribers from the effect.
 * Effects must be disposed of after use outside components using the cleanup function.
 */
function effect(fn) {
	const effectFn = () => {
		cleanupDependencies(effectFn);
		effectFn.processedSubscribers = new Set();
		const previousEffect = currentEffect;  // Save previous effect
		currentEffect = effectFn;
		try {
			return fn();
		} finally {
			currentEffect = previousEffect;  // Restore previous effect
		}
	};

	effectFn.dependencies = new Set();
	effectFn.processedSubscribers = new Set();

	const cleanup = () => {
		cleanupDependencies(effectFn);
		pendingEffects.delete(effectFn);
	};

	effectFn();
	return cleanup;
}

// UI Effect Implementation
function UIeffect(fn) {
	let isScheduled = false;
	const c = computed(fn);

	const dispose = effect(() => {
		c.v; // Track dependencies
		if (!isScheduled) {
			isScheduled = true;
			requestAnimationFrame(() => {
				isScheduled = false;
				fn();
			});
		}
	});

	return dispose;
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
	effectFn.dependencies.forEach(cleanup => cleanup());
	effectFn.dependencies.clear();
}

export { signal, computed, effect, UIeffect, bound };