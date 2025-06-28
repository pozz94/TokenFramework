// signal.js

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

const isObject = (obj) => typeof obj === 'object' && obj !== null;
const isArray = (arr) => Array.isArray(arr);

// Helper function to check if objects have the same keys
function objectsHaveSameKeys(obj1, obj2) {
  const keys1 = Object.keys(obj1);
  const keys2 = Object.keys(obj2);
  if (keys1.length !== keys2.length) return false;
  return keys1.every(key => Object.prototype.hasOwnProperty.call(obj2, key));
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
			if (isObject(val) && (isArray(val) || Object.getPrototypeOf(val) === Object.prototype)) {
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
			if (!isObject(value) || (!isArray(value) && Object.getPrototypeOf(value) !== Object.prototype)) {
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
	}
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

			// For other properties, access the underlying value
			const internalValue = target.getValue ? target.getValue() : undefined;

			// If value is an object/array, handle property access based on the internal signal structure
			if (isObject(internalValue)) {
				// Special handling for array methods
				if (isArray(internalValue) && typeof Array.prototype[prop] === 'function' &&
					['push', 'pop', 'shift', 'unshift', 'splice', 'sort', 'reverse'].includes(prop)) {
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

				// Special handling for non-mutating array methods
				if (isArray(internalValue) && typeof Array.prototype[prop] === 'function' &&
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
	const result = signal({ loading: false, error: undefined, data: undefined });

	let disposeEffect;

	result.onFirstSubscriber(() => {
		disposeEffect = effect(() => {
			const controller = new AbortController();
			const sourceValue = {
				...typeof source?.v === 'object' ? source.v : { url: typeof source?.v === 'string' ? source.v : typeof source === 'string' ? source : '' },
				signal: controller.signal
			};

			result.v = { loading: true, error: undefined, data: undefined };

			fetcher(sourceValue)
				.then(value => { if (!controller.signal.aborted) { result.v = { loading: false, data: value, error: undefined }; } })
				.catch(err => { if (!controller.signal.aborted && err.name !== 'AbortError') { result.v = { loading: false, error: err, data: undefined }; } });

			// Cleanup function that aborts the request
			return () => controller.abort();
		});
	});

	result.onLastSubscriberRemoved(() => { if (disposeEffect) disposeEffect(); });

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

untrack = function (fn) {
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

const isWebComponent = (element) => element instanceof HTMLElement && element.tagName.includes('-');

const convertToSignal = (value, context) => {
	if (isSignal(value)) return value;
	if (typeof value === 'function') return computed(wrapInContext(value, context));
	return signal(value);
};

const sanitizeHTML = (value) => {
	if (typeof value !== 'string') return value;
	const element = document.createElement('div');
	element.textContent = value;
	return element.innerHTML;
};

const BOOLEAN_ATTRIBUTES = new Set([
	'checked', 'selected', 'disabled', 'readonly', 'required', 'hidden', 'multiple', 'open', 'autofocus', 'loop', 'muted', 'controls', 'autoplay'
]);

const findTemplateBindings = (node, bindingValues, currentNodeIndex = []) => {
	const fullReplacementPlaceholder = /\{\{--(\d+)--\}\}/;
	const partialReplacementPlaceholder = /\'\{\{--(\d+)--\}\}\'/g;

	let bindingFunctions = [];
	let slots = [];
	let componentSlots = [];
	let styleElements = [];

	let generatedSubComponent = false;

	const handleFullReplacementAndPush = (name, value, callback) => {
		const fullReplacementPlaceholder = /\{\{--(\d+)--\}\}/;
		const match = value.match(fullReplacementPlaceholder);
		if (match) {
			const index = parseInt(match[1], 10);
			bindingFunctions.push((bindingValues, node, context) => callback(bindingValues[index], node, context));
			node.removeAttribute(name);
		}
		return match !== null;
	};

	switch (node.nodeType) {
		// handle text nodes and comments
		case Node.TEXT_NODE:
		case Node.COMMENT_NODE:
			if (partialReplacementPlaceholder.test(node.nodeValue)) {
				if (node?.parentElement?.tagName === 'STYLE') {
					console.error("Style elements can't have bound state since they are added only once to the head of the document for all components of the same type");
					break;
				}
				const { parts, indices } = splitTemplate(node.nodeValue);
				bindingFunctions.push((bindingValues, node, context) => {
					const expressions = [];

					for (const index of indices) {
						expressions.push(convertToSignal(bindingValues[index], context));
					}

					return effect.UI(wrapInContext(() => {
						let newValue = '';
						let index = 0;
						for (const part of parts) {
							newValue += part + (isSignal(expressions[index]) && !expressions[index]?.v?.proxy ? expressions[index].v : '');
							index++;
						}
						node.nodeValue = newValue;
					}, context));
				});
			}
			break;
		// handle element nodes
		case Node.ELEMENT_NODE:
			const attributes = Array.from(node.attributes);

			if (node.tagName === 'SLOT') {
				if (!node.hasAttribute('component')) {
					slots.push([node.getAttribute('name') ?? 'default', currentNodeIndex]);
				}
			} else if (node.tagName === 'STYLE') {
				styleElements.push(node);
				return { bindings: [], slots: [], styleElements };
			} else if (node.tagName === 'W') {
				bindingFunctions.push((bindingValues, node) => {
					node.style.display = 'contents';
				});
			}

			for (const { name, value } of attributes) {
				if (value.includes('{{--')) {
					if (name.startsWith('on')) { // handle event attributes
						handleFullReplacementAndPush(name, value, (bindingValue, node, context) => {
							if (typeof bindingValue === 'function') {
								node.addEventListener(name.substring(2).toLowerCase(), wrapInContext(bindingValue, context));
							} else {
								console.error('event attributes must be functions');
							}
						});
					} else if (name === ":this") {
						handleFullReplacementAndPush(name, value, (bindingValue, node) => {
							if (isSignal(bindingValue)) {
								bindingValue.v = node;
							} else {
								console.error('to save a reference to the element, a signal must be passed as an argument');
							}
						});
					} else if (name === "apply") {
						handleFullReplacementAndPush(name, value, (bindingValue, node, context) => {
							if (typeof bindingValue === 'function') {
								wrapInContext(() => bindingValue(node), context)();
							} else {
								console.error('apply accepts only functions as an argument');
							}
						});
					} else if (name.startsWith(':')) { // handle bound attributes
						handleFullReplacementAndPush(name, value, (bindingValue, node, context) => {
							if (isSignal(bindingValue) || typeof bindingValue === 'function') {
								return createTwoWayBinding(node, name.substring(1), convertToSignal(bindingValue, context));
							} else {
								console.error('bound attribute must be a signal');
							}
						});
					} else if (BOOLEAN_ATTRIBUTES.has(name.toLowerCase())) {
						handleFullReplacementAndPush(name, value, (bindingValue, node, context) => {
							if (isSignal(bindingValue) || typeof bindingValue === 'function') {
								bindingValue = convertToSignal(bindingValue, context);
								return effect.UI(wrapInContext(() => node[name] = bindingValue.v, context));
							} else {
								console.error('boolean attributes must be signals');
							}
						});
					} else if (name === "if") {
						generatedSubComponent = true;
						bindingFunctions.push(conditionalHandler(node, bindingValues));
					} else if (name === "await") {
						generatedSubComponent = true;
						bindingFunctions.push(resourceHandler(node, bindingValues));
					} else if (name.startsWith('each:')) {
						generatedSubComponent = true;
						bindingFunctions.push(listHandler(node, bindingValues, name));
					} else {
						if (partialReplacementPlaceholder.test(value)) { // handle partial replacement
							const { parts, indices } = splitTemplate(value);
							bindingFunctions.push((bindingValues, node, context) => {
								const expressions = [];
								for (const index of indices) {
									expressions.push(convertToSignal(bindingValues[index], context));
								}
								return effect.UI(wrapInContext(() => {
									let newValue = '';
									let index = 0;
									for (const part of parts) {
										newValue += part + (expressions[index]?.v ?? '');
										index++;
									}
									node.setAttribute(name, newValue);
								}, context));
							});
						} else if (fullReplacementPlaceholder.test(value)) { // handle full replacement
							handleFullReplacementAndPush(name, value, (bindingValue, node, context) => {
								if (typeof bindingValue === 'function' && isWebComponent(node)) {
									node.setAttribute(name, wrapInContext(bindingValue, context), true);
								}
								else {
									const bindingValueSignal = convertToSignal(bindingValue, context);
									return effect.UI(wrapInContext(() => node.setAttribute(name, bindingValueSignal.v), context));
								}
							});
						}
					}
				}
			}
	}

	if (isWebComponent(node)) bindingFunctions.push((bindingValues, node) => { node.setAttribute('render', true); });

	const bindings = bindingFunctions.length ? [{ index: currentNodeIndex, bindingFunctions }] : [];

	if (generatedSubComponent) return { bindings, slots, componentSlots, styleElements };

	for (let i = 0; i < node.childNodes.length; i++) {
		const { bindings: childBindings, slots: childSlots = [], componentSlots: childComponentSlots = [], styleElements: childStyles = [] } = findTemplateBindings(node.childNodes[i], bindingValues, [...currentNodeIndex, i]);
		bindings.push(...childBindings);
		slots.push(...childSlots);
		componentSlots.push(...childComponentSlots);
		styleElements.push(...childStyles);
	}

	return { bindings, slots, componentSlots, styleElements };
};

const createTwoWayBinding = (element, boundAttrName, sig) => {
	// Handle signal changes
	if (!isWebComponent(element)) {
		// Handle attribute changes
		element.addEventListener('input', (e) => {
			sig.v = e.target.type === 'number' || e.target.type === 'range'
				? Number(element[boundAttrName])
				: element[boundAttrName];
		});
		return effect.UI(() => {
			element[boundAttrName] = sig.v;
		});
	}
	else {
		element.setAttribute(boundAttrName, sig, true);
	}
};

const waitOverride = (element, func) => {
	const tryFunc = (attempts = 0) => {
		if (element.setAttribute !== HTMLElement.prototype.setAttribute) {
			func();
		} else if (attempts < 10) queueMicrotask(() => tryFunc(attempts + 1));
		else console.error(`Too many attempts at waiting for the element to be upgraded`);
	};
	tryFunc();
};

const applyBindings = async (bindings, bindingValues, origin, context, parentName) => {
	const cleanups = [];
	if (bindings.length) {
		for (const { index, bindingFunctions } of bindings) {
			const element = getNodeAtIndex(index, origin);
			if (isWebComponent(element)) {
				waitOverride(element, () => {
					for (const func of bindingFunctions) {
						const cleanup = func(bindingValues, element, context, parentName);
						if (cleanup && typeof cleanup === 'function') cleanups.push(cleanup);
					}
				});
			} else {
				for (const func of bindingFunctions) {
					const cleanup = func(bindingValues, element, context, parentName);
					if (cleanup && typeof cleanup === 'function') cleanups.push(cleanup);
				}
			}
		}
	}
	return cleanups;
};

const getNodeAtIndex = (index, node) => {
	for (const i of index) { node = node.childNodes[i]; }
	return node;
};

function splitTemplate(str) {
	const partialReplacementPlaceholder = /\'\{\{--(\d+)--\}\}\'/g;

	const parts = [];
	const indices = [];
	let lastIndex = 0;
	const matches = [...str.matchAll(partialReplacementPlaceholder)];
	let temp = '';

	for (const match of matches) {
		const currentPart = str.slice(lastIndex, match.index);
		const index = parseInt(match[1], 10);

		// If it is a signal, keep them separate
		parts.push(temp + currentPart);
		indices.push(index);
		temp = '';

		lastIndex = match.index + match[0].length;
	}
	parts.push(temp + str.slice(lastIndex));

	return { parts, indices };
}

const randomId = () => {
	return Math.random().toString(36).substring(2, 7);
};

// Create a component from nodes
const createComponent = (nodes, bindingValues) => {
	const template = document.createElement('template');
	for (const node of nodes) { template.content.appendChild(node.cloneNode(true)); }
	const bindings = findTemplateBindings(template.content, bindingValues);
	return bindingValues => token(() => html([], ...bindingValues), {
		template: template.content,
		...bindings
	});
};

const parseConditionIndex = (attributeValue) => {
	const match = attributeValue?.match(/\{\{--(\d+)--\}\}/);
	return match ? parseInt(match[1], 10) : undefined;
};

const conditionalHandler = (node, bindingValues, branchGeneration = ifHandler) => {
	const branches = branchGeneration(node, bindingValues);

	// Return the binding function
	return (bindingValues, node, context) => {
		const instanceBranches = branches.map(branch => ({
			...branch,
			condition: branch.conditionGenerator(bindingValues, context, branch.conditionIndex)
		}));

		effect.UI(() => {
			// Clear existing content
			node.innerHTML = '';

			// Find and render the first matching branch
			for (const branch of instanceBranches) {
				if (!!branch.condition.v) {
					const element = document.createElement(branch.component(bindingValues));
					element.setContext(context);
					node.appendChild(element);
					break;
				}
			}
		});
	};
};

const ifHandler = (node, bindingValues) => {
	// Setup branch collection
	const branches = [];
	const childNodes = Array.from(node.childNodes);
	let currentNodes = [];
	let conditionIndex = parseConditionIndex(node.getAttribute('if'));

	// Remove the if attribute as it's been processed
	node.removeAttribute('if');

	const conditionGenerator = (bindingValues, context, conditionIndex) => {
		return convertToSignal(
			conditionIndex !== null ? bindingValues[conditionIndex] : signal(true),
			context);
	};

	// Process child nodes to identify branches
	for (const childNode of childNodes) {
		const isBranchMarker = childNode?.tagName === 'BR' &&
			(childNode.hasAttribute('else') || childNode.hasAttribute('elseif'));

		if (isBranchMarker) {
			// Store the current branch before starting a new one
			branches.push({
				conditionIndex,
				conditionGenerator,
				component: createComponent(currentNodes, bindingValues)
			});

			// Start a new branch
			currentNodes = [];
			conditionIndex = childNode.hasAttribute('elseif')
				? parseConditionIndex(childNode.getAttribute('elseif'))
				: null;
		} else {
			currentNodes.push(childNode);
		}
	}

	// Add the final branch (if any nodes remain)
	if (currentNodes.length > 0) {
		branches.push({
			conditionIndex,
			conditionGenerator,
			component: createComponent(currentNodes, bindingValues)
		});
	}

	// Return the branches
	return branches;
};

const resourceHandler = (node, bindingValues) => conditionalHandler(node, bindingValues, resourceBranchGeneration);

const resourceBranchGeneration = (node, bindingValues) => {
	const branchObj = {};

	const childNodes = Array.from(node.childNodes);
	let currentNodes = [];
	let currentState = 'data';

	const resourceIndex = parseConditionIndex(node.getAttribute('await'));
	node.removeAttribute('await');

	for (const childNode of childNodes) {
		const isStateMarker = childNode?.tagName === 'BR' &&
			(childNode.hasAttribute('loading') || childNode.hasAttribute('error'));

		if (isStateMarker) {
			branchObj[currentState] = createComponent(currentNodes, bindingValues);
			currentNodes = [];
			currentState = childNode.hasAttribute('loading') ? 'loading' : 'error';
		} else {
			currentNodes.push(childNode);
		}
	}

	if (currentNodes.length > 0) {
		branchObj[currentState] = createComponent(currentNodes, bindingValues);
	}

	const branchOrder = ['loading', 'error', 'data'];

	return branchOrder
		.filter(state => branchObj[state])
		.map(state => {
			const capturedState = state;
			return {
				conditionIndex: resourceIndex,
				component: branchObj[capturedState],
				conditionGenerator: function (bindingValues, context, resourceIndex) {
					const resource = convertToSignal(bindingValues[resourceIndex], context);
					console.log(resource.v, capturedState);
					return computed(() => resource[capturedState].v);
				}
			};
		});
};


const listComponentCache = new Map();

const listHandler = (node, bindingValues, name) => {
	const iteratorName = name.substring(5);
	let func;

	let callback = (bindingValue, node, bindingValues, context, bindingIndex, parentName) => {
		// Create a unique but compact template key using parent info and binding index
		const templateKey = `${parentName}-${iteratorName}-${bindingIndex}`;

		let componentName;

		// Check if we already have a component for this exact template
		if (listComponentCache.has(templateKey)) {
			componentName = listComponentCache.get(templateKey);
		} else {
			// If not, create it and cache it
			const template = document.createElement('template').content;

			for (const child of node.childNodes) {
				template.appendChild(child.cloneNode(true));
			}

			const listBindings = findTemplateBindings(template, bindingValues);

			// Create the component definition once
			componentName = token(() => html([], ...bindingValues), { template, ...listBindings });

			// Store in cache for future use
			listComponentCache.set(templateKey, componentName);
		}

		const length = computed(() => bindingValue.v.length);

		effect.UI(() => {
			node.innerHTML = '';
			bindingValue = convertToSignal(bindingValue);

			for (let i = 0; i < length.v; i++) {
				const componentElement = document.createElement(componentName);
				waitOverride(componentElement, () =>
					componentElement.setContext({
						[iteratorName]: bindingValue[i],
						[iteratorName + "Index"]: i,
						...context
					})
				);
				node.appendChild(componentElement);
			}
		});
	};

	const match = node.getAttribute(`each:${iteratorName}`).match(/\{\{--(\d+)--\}\}/);
	if (match) {
		const index = parseInt(match[1], 10);
		node.removeAttribute(name);
		return (bindingValues, node, context, parentName) => callback(convertToSignal(bindingValues[index], context), node, bindingValues, context, index, parentName);
	}
	return func;
};

const wrapInContext = (fn, context) => {
	if (!context || !Object.keys(context).length) return fn;
	return (...args) => {
		// Store original values
		const originalValues = {};
		Object.keys(context).forEach(key => {
			if (key in window) originalValues[key] = window[key];
		});

		// Add context properties
		Object.assign(window, context);

		let result;
		try {
			result = fn(...args);
		} finally {
			// Restore original state
			Object.keys(context).forEach(key => {
				if (key in originalValues) {
					window[key] = originalValues[key];
				} else {
					delete window[key];
				}
			});
		}
		return result;
	};
};

const createTemplateFromLiteral = (strings, ...bindingValues) => {
	const templateString = strings.reduce((acc, str, i) => {
		// If we're at the last string piece and no more values, just append it
		if (i >= bindingValues.length) {
			return acc + str;
		}
		//if value is not a signal or a function just append it
		//but warn the user that the value is not reactive
		if (typeof bindingValues[i] === 'string' || typeof bindingValues[i] === 'number') {
			if (!str.endsWith('<') && !str.endsWith('</')) {
				console.warn(`Value or variable containing "${bindingValues[i]}" after\n"...${(acc + str).substr(-200)}"\nis not reactive, is it what you intended?`);
			}
			return acc + str + sanitizeHTML(bindingValues[i]);
		}

		return acc + str + `'{{--${i}--}}'`;
	}, '').replace(/[^\S\r\n]+/g, ' ');

	const template = document.createElement('template');
	template.innerHTML = templateString;

	return template.content;
};

const registeredComponentList = new Set();

const component = (name, factory, bypass = {}) => {
	if (registeredComponentList.has(name)) {
		console.warn(`Component with name ${name} already exists`);
		return;
	}

	registeredComponentList.add(name);

	let template = bypass?.template || null;
	let styleElement = null;
	let instanceCount = 0;
	let bindings = bypass?.bindings || [];
	let slots = bypass?.slots || [];

	customElements.define(name, class extends HTMLElement {
		#props = {};
		#mountHooks = [];
		#unmountHooks = [];
		#content = null;
		#templateRendererCalled = false;
		#additionalContext = null;
		#id = null;

		constructor() {
			instanceCount++;
			//if factory is async, throw error
			if (factory.constructor.name === "AsyncFunction") {
				throw new Error('Factory function inside token() cannot be async');
			}
			super();
		}

		#prepareContent() {
			Array.from(this.attributes).forEach(({ name, value }) => {
				if (name === 'render' && value === '') return;
				else if (!this.#props.hasOwnProperty(name)) this.setAttribute(name, value === '' ? true : value);
			});

			for (const [key, value] of Object.entries(this.#props)) {
				if (typeof value !== 'function' && !isSignal(value)) {
					this.#props[key] = signal(value);
				}
			}

			const context = {
				lifeCycle: {
					onMount: (fn) => this.#mountHooks.push(fn),
					onUnmount: (fn) => this.#unmountHooks.push(fn),
				},
				html: (strings, ...bindingValues) => this.#templateRenderer(strings, bindingValues),
				signal,
				computed,
				effect: this.#trackedCleanupEffect
			};

			const proxyProps = new Proxy(this.#props, {
				//list all props that are accessed to check if they are set in the custom element in the html page
				get(target, prop) {
					prop = String(prop).toLowerCase();
					if (!(prop in target)) {
						console.warn(`Property ${prop} is not set in the custom element`);
						return undefined;
					}
					return Reflect.get(target, prop, this);
				}
			});

			wrapInContext(() => factory(proxyProps, context), context)();
		}

		#createTrackedEffect = (effectFn) => (...args) => {
			const cleanup = effectFn(...args);
			this.#unmountHooks.push(cleanup);
			return cleanup;
		};

		#trackedCleanupEffect = new Proxy(this.#createTrackedEffect(effect), {
			get: (_, prop) => {
				const effectFn = effect[prop];
				if (typeof effectFn === 'function') {
					return this.#createTrackedEffect(effectFn);
				}
				return effectFn;
			}
		});

		#templateRenderer = (strings, bindingValues) => {
			if (this.#templateRendererCalled === true) {
				console.error('html() can only be called once inside a component');
				return;
			}
			this.#templateRendererCalled = true;

			if (!template) {
				this.#prepareTemplate(strings, bindingValues);
			}

			this.#generateCopy(bindingValues);
		};

		#generateCopy = async (bindingValues) => {
			const copy = template.cloneNode(true);

			const cleanups = await applyBindings(bindings, bindingValues, copy, this.#additionalContext, name);
			this.#unmountHooks.push(...cleanups);

			const slotElements = Object.fromEntries(slots.map(([slotName, index]) => [slotName, getNodeAtIndex(index, copy)]));

			const plugs = {};

			for (const child of Array.from(this.children)) {
				const slotName = child.getAttribute('slot') || 'default';
				if (!slotElements[slotName]) {
					console.warn(`No matching slot "${slotName}" found for:`, child);
					child.remove();
				} else {
					if (!plugs[slotName]) plugs[slotName] = [];
					plugs[slotName].push(child);
				}
			}
			//replace default content from slots if there are plugs for them
			for (const [slotName, children] of Object.entries(plugs)) {
				if (slotElements[slotName]) {
					slotElements[slotName].innerHTML = '';
					slotElements[slotName].style.display = 'contents';
					children.forEach(child => slotElements[slotName].appendChild(child));
				}
			}


			this.#content = copy;
			this.appendChild(this.#content);
			this.#mountHooks.forEach(hook => hook());
		};

		//public and utility methods

		#prepareTemplate = (strings, bindingValues) => {
			template = createTemplateFromLiteral(strings, ...bindingValues);
			const { bindings: foundBindings, slots: foundSlots, styleElements } = findTemplateBindings(template, bindingValues);

			// Handle styles
			if (styleElements.length > 0) {
				const combinedStyles = styleElements
					.map(style => style.textContent)
					.join('\n');

				styleElement = document.createElement('style');
				styleElement.setAttribute('data-component', name);
				styleElement.textContent = combinedStyles;
				document.head.appendChild(styleElement);

				// Remove style elements from template
				styleElements.forEach(style => style.remove());
			}

			bindings = foundBindings;
			slots = foundSlots;
		};

		setContext(context) {
			this.#additionalContext = context;
			this.#prepareContent();
		}

		setAttribute(name, value, bind = false) {
			if (name === 'render' && value === true) {
				this.#prepareContent();

				return;
			}

			const type = isSignal(value) ? 'signal' : typeof value;

			if (type === 'function') {
				this.#props[name] = value;
				super.setAttribute(name, 'functionAttribute');
				return;
			}

			if (!this.#props[name] && !bind) {
				this.#props[name] = signal(value);
				effect(() => super.setAttribute(name, this.#props[name].v));
			}

			if (type === 'signal') {
				super.setAttribute(name, value.v);
				if (!bind) this.#props[name].v = value.v;
				else {
					this.#props[name] = value;
					effect(() => super.setAttribute(name, this.#props[name].v));
				}			} else {
				super.setAttribute(name, value);
				this.#props[name].v = value;
			}

			//effect(() => super.setAttribute(name, this.#props[name].v)); //possibly duplicated from when the attribute was set the previous time
		}

		getAttribute(name, raw = false) {
			if (raw) return this.#props[name] ?? super.getAttribute(name);
			else return this.#props[name]?.v ?? super.getAttribute(name);
		}

		connectedCallback() {
			this.#id = randomId();
			this.style.display = 'contents';

			if (this.getAttribute('render') === '') {
				this.#prepareContent();
			}
		}

		disconnectedCallback() {
			instanceCount--;
			if (instanceCount === 0 && styleElement) {
				styleElement.remove();
				styleElement = null;
			}
			this.#unmountHooks.forEach(hook => hook());
		}
	});

	return name;
};

const token = (factoryOrString, bypassOrFactory, bypass) => {
	if (typeof factoryOrString === 'string' && typeof bypassOrFactory === 'function') {
		return component(factoryOrString, bypassOrFactory, bypass);
	} else if (typeof factoryOrString === 'function' && (!bypassOrFactory || typeof bypassOrFactory === 'object')) {
		let name;
		do name = `tok-${randomId()}-${randomId()}`;
		while (registeredComponentList.has(name));
		return component(name, factoryOrString, bypassOrFactory);
	}
	console.error('Invalid arguments passed to token()', factoryOrString, bypassOrFactory, bypass);
};

export { computed, token as default, effect as dirtyEffect, signal, token };
//# sourceMappingURL=token.js.map
