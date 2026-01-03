import { signal, computed, effect, isSignal } from './signalNew6.js';
//import { signal, computed, effect, isSignal } from './signalNew2.js';
//import { signal, computed, effect, isSignal } from './signal.js';
import { scopeCSS } from './cssProcessing.js';
import { wrapInContext } from './utils.js';

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

const FULL_REPLACEMENT_PLACEHOLDER = /\{\{--(\d+)--\}\}/;
const PARTIAL_REPLACEMENT_PLACEHOLDER = /\'\{\{--(\d+)--\}\}\'/g;

// Hash function for template strings - simple but effective
const hashTemplateString = (str) => {
	let hash = 0;
	for (let i = 0; i < str.length; i++) {
		const char = str.charCodeAt(i);
		hash = ((hash << 5) - hash) + char;
		hash = hash & hash; // Convert to 32-bit integer
	}
	return hash.toString(36);
};

// Global cache for shared component data based on template hash
// Structure: Map<hash, { template, bindings, slots, styleElement, globalStyleElement, scopeClassName, componentNames: Set<string> }>
const templateCache = new Map();

const findTemplateBindings = (node, bindingValues, currentNodeIndex = []) => {
	const fullReplacementPlaceholder = new RegExp(FULL_REPLACEMENT_PLACEHOLDER.source);
	const partialReplacementPlaceholder = new RegExp(PARTIAL_REPLACEMENT_PLACEHOLDER.source, 'g');

	let bindingFunctions = [];
	let slots = [];
	let componentSlots = [];
	let styleElements = [];

	let generatedSubComponent = false;

	const handleFullReplacementAndPush = (name, value, callback) => {
		const match = value.match(fullReplacementPlaceholder);
		if (match) {
			const index = parseInt(match[1], 10);
			bindingFunctions.push((bindingValues, node, context, parentName, trackedEffect) =>
				callback(bindingValues[index], node, context, trackedEffect));
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
				bindingFunctions.push((bindingValues, node, context, parentName, trackedEffect) => {
					const expressions = [];

					for (const index of indices) {
						expressions.push(convertToSignal(bindingValues[index], context));
					}

					const effectToUse = trackedEffect || effect;
					return effectToUse.UI(wrapInContext(() => {
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

			for (const { name, value } of Array.from(node.attributes)) {
				if (!value.includes('{{--')) continue;

				// Handle special attributes
				if (name.startsWith('on')) { // handle event attributes
					handleFullReplacementAndPush(name, value, (bindingValue, node, context, trackedEffect) => {
						if (typeof bindingValue === 'function') {
							const eventName = name.substring(2).toLowerCase();
							const handler = wrapInContext(bindingValue, context);
							node.addEventListener(eventName, handler);
							// Return cleanup function to remove event listener
							return () => node.removeEventListener(eventName, handler);
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
					handleFullReplacementAndPush(name, value, (bindingValue, node, context, trackedEffect) => {
						if (isWebComponent(node)) {
							// For web components with :attr, pass through directly (bind=true)
							node.setAttribute(name.substring(1), bindingValue, true);
						} else if (isSignal(bindingValue) || typeof bindingValue === 'function') {
							// For regular elements, create two-way binding
							return createTwoWayBinding(node, name.substring(1), convertToSignal(bindingValue, context), trackedEffect);
						} else {
							console.error('bound attribute must be a signal or function');
						}
					});
				} else if (BOOLEAN_ATTRIBUTES.has(name.toLowerCase())) {
					handleFullReplacementAndPush(name, value, (bindingValue, node, context, trackedEffect) => {
						if (isSignal(bindingValue) || typeof bindingValue === 'function') {
							bindingValue = convertToSignal(bindingValue, context);
							const effectToUse = trackedEffect || effect;
							return effectToUse.UI(wrapInContext(() => node[name] = bindingValue.v, context));
						} else {
							console.error('boolean attributes must be signals');
						}
					});
				} else if (name === "if") {
					generatedSubComponent = true;
					// We'll need to pass parent scope dynamically, store a marker
					bindingFunctions.push((bindingValues, node, context, parentName) => {
						const parentScope = context.__parentScopeClass || parentName || null;
						const branches = ifHandler(node, bindingValues, parentScope);
						return conditionalHandler(node, bindingValues, () => branches)(bindingValues, node, context, parentName);
					});
				} else if (name === "await") {
					generatedSubComponent = true;
					bindingFunctions.push((bindingValues, node, context, parentName) => {
						const parentScope = context.__parentScopeClass || parentName || null;
						const branches = resourceBranchGeneration(node, bindingValues, parentScope);
						return conditionalHandler(node, bindingValues, () => branches)(bindingValues, node, context, parentName);
					});
				} else if (name.startsWith('each:')) {
					generatedSubComponent = true;
					bindingFunctions.push(listHandler(node, bindingValues, name));
				} else if (partialReplacementPlaceholder.test(value)) { // handle partial replacement
					const { parts, indices } = splitTemplate(value);
					bindingFunctions.push((bindingValues, node, context, parentName, trackedEffect) => {
						const expressions = [];
						for (const index of indices) {
							expressions.push(convertToSignal(bindingValues[index], context));
						}
						const effectToUse = trackedEffect || effect;
						return effectToUse.UI(wrapInContext(() => {
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
					handleFullReplacementAndPush(name, value, (bindingValue, node, context, trackedEffect) => {
						if (isWebComponent(node)) {
							// For web components, pass the value directly (setAttribute will handle wrapping)
							node.setAttribute(name, bindingValue, false);
						}
						else {
							const bindingValueSignal = convertToSignal(bindingValue, context);
							const effectToUse = trackedEffect || effect;
							return effectToUse.UI(wrapInContext(() => node.setAttribute(name, bindingValueSignal.v), context));
						}
					});
				}

			}
	}

	if (isWebComponent(node)) bindingFunctions.push((bindingValues, node) => { node.setAttribute('render', true); });

	let bindings = bindingFunctions.length ? [{ index: currentNodeIndex, bindingFunctions }] : [];

	if (generatedSubComponent) return { bindings, slots, componentSlots, styleElements };

	for (let i = 0; i < node.childNodes.length; i++) {
		const { bindings: childBindings, slots: childSlots = [], componentSlots: childComponentSlots = [], styleElements: childStyles = [] } = findTemplateBindings(node.childNodes[i], bindingValues, [...currentNodeIndex, i]);
		bindings = bindings.concat(childBindings);
		slots = slots.concat(childSlots);
		componentSlots = componentSlots.concat(childComponentSlots);
		styleElements = styleElements.concat(childStyles);
	}

	return { bindings, slots, componentSlots, styleElements };
};

const createTwoWayBinding = (element, boundAttrName, sig, trackedEffect) => {
	// Handle signal changes
	if (!isWebComponent(element)) {
		// Handle attribute changes
		const inputHandler = (e) => {
			sig.v = e.target.type === 'number' || e.target.type === 'range'
				? Number(element[boundAttrName])
				: element[boundAttrName];
		};
		element.addEventListener('input', inputHandler);

		const effectToUse = trackedEffect || effect;
		effectToUse.UI(() => {
			element[boundAttrName] = sig.v;
		});

		// If not using trackedEffect, return cleanup function manually
		if (!trackedEffect) {
			return () => {
				element.removeEventListener('input', inputHandler);
			};
		}

		// If using trackedEffect, register event listener cleanup
		if (trackedEffect) {
			trackedEffect(() => element.removeEventListener('input', inputHandler));
		}
		// trackedEffect already tracked the effect cleanup
	}
	else {
		element.setAttribute(boundAttrName, sig, true);
	}
};

//const waitOverride = (element, func) => {
//	const tryFunc = (attempts = 0) => {
//		if (element.setAttribute !== HTMLElement.prototype.setAttribute) {
//			func();
//		} else if (attempts < 10) queueMicrotask(() => tryFunc(attempts + 1));
//		else console.error(`Too many attempts at waiting for the element to be upgraded`);
//	};
//	tryFunc();
//};

const waitOverride = async (element, func, abortSignal) => {
	// If already aborted, don't do anything
	if (abortSignal?.aborted) return;

	await customElements.whenDefined(element.tagName.toLowerCase());

	// Check again if aborted before executing
	if (abortSignal?.aborted) return;

	queueMicrotask(() => {
		if (!abortSignal?.aborted) {
			func();
		}
	});
};

const applyBindings = async (bindings, bindingValues, origin, context, parentName, trackedEffect) => {
	const abortController = new AbortController();

	// If using trackedEffect, add abort to tracked cleanups, otherwise return it
	if (trackedEffect) {
		// trackedEffect will automatically track all cleanup functions
		trackedEffect(() => abortController.abort());
	}

	if (bindings.length) {
		for (const { index, bindingFunctions } of bindings) {
			const element = getNodeAtIndex(index, origin);
			if (isWebComponent(element)) {
				waitOverride(element, () => {
					for (const func of bindingFunctions) {
						// If trackedEffect is used, cleanups are auto-tracked, no need to collect
						func(bindingValues, element, context, parentName, trackedEffect);
					}
				}, abortController.signal);
			} else {
				for (const func of bindingFunctions) {
					// If trackedEffect is used, cleanups are auto-tracked, no need to collect
					func(bindingValues, element, context, parentName, trackedEffect);
				}
			}
		}
	}

	// Only return cleanup for abort if not using trackedEffect
	if (!trackedEffect) {
		return [() => abortController.abort()];
	}
	return [];
};

const getNodeAtIndex = (index, node) => {
	for (const i of index) { node = node.childNodes[i]; }
	return node;
};

function splitTemplate(str) {
	const partialReplacementPlaceholder = new RegExp(PARTIAL_REPLACEMENT_PLACEHOLDER.source, 'g');

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
const createComponent = (nodes, bindingValues, parentScopeClass = null) => {
	const template = document.createElement('template');
	for (const node of nodes) { template.content.appendChild(node.cloneNode(true)); };

	const bindings = findTemplateBindings(template.content, bindingValues);
	return bindingValues => token(() => html([], ...bindingValues), {
		template: template.content,
		...bindings,
		parentScopeClass  // Pass parent scope class
	});
};

const parseConditionIndex = (attributeValue) => {
	const fullReplacementPlaceholder = new RegExp(FULL_REPLACEMENT_PLACEHOLDER.source);
	const match = attributeValue?.match(fullReplacementPlaceholder);
	return match ? parseInt(match[1], 10) : undefined;
};

const conditionalHandler = (node, bindingValues, branchGeneration = ifHandler) => {
	const branches = branchGeneration(node, bindingValues);

	// Return the binding function
	return (bindingValues, node, context, parentName, trackedEffect) => {
		const instanceBranches = branches.map(branch => ({
			...branch,
			condition: branch.conditionGenerator(bindingValues, context, branch.conditionIndex)
		}));

		let currentElement = null;

		const effectToUse = trackedEffect || effect;
		const cleanup = effectToUse.UI(() => {
			// Clean up previous element properly
			if (currentElement) {
				// Trigger disconnectedCallback if it's a custom element
				if (currentElement.remove) {
					currentElement.remove();
				}
				currentElement = null;
			}

			// Clear any remaining content
			node.innerHTML = '';

			// Find and render the first matching branch
			for (const branch of instanceBranches) {
				if (!!branch.condition.v) {
					currentElement = document.createElement(branch.component(bindingValues));
					// Pass parent's scope class via context (only if it exists)
					const parentScope = context.__parentScopeClass || parentName;
					const contextToPass = parentScope ? {...context, __parentScopeClass: parentScope} : context;
					currentElement.setContext(contextToPass);
					node.appendChild(currentElement);
					break;
				}
			}
		});

		// If not using trackedEffect, return cleanup function manually
		if (!trackedEffect) {
			return () => {
				if (currentElement) {
					currentElement.remove();
					currentElement = null;
				}
				if (cleanup && typeof cleanup === 'function') {
					cleanup();
				}
			};
		}
		// trackedEffect already tracked the cleanup
	};
};

const ifHandler = (node, bindingValues, parentScopeClass) => {
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
		const isBranchMarker = childNode?.tagName === 'TEMPLATE' &&
			(childNode.hasAttribute('else') || childNode.hasAttribute('elseif'));

		if (isBranchMarker) {
			// Store the current branch before starting a new one
			branches.push({
				conditionIndex,
				conditionGenerator,
				component: createComponent(currentNodes, bindingValues, parentScopeClass)
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
			component: createComponent(currentNodes, bindingValues, parentScopeClass)
		});
	}

	// Return the branches
	return branches;
};

const resourceHandler = (node, bindingValues) => conditionalHandler(node, bindingValues, resourceBranchGeneration);

const resourceBranchGeneration = (node, bindingValues, parentScopeClass) => {
	const branchObj = {};

	const childNodes = Array.from(node.childNodes);
	let currentNodes = [];
	let currentState = 'data';

	const resourceIndex = parseConditionIndex(node.getAttribute('await'));
	node.removeAttribute('await');

	for (const childNode of childNodes) {
		const isStateMarker = childNode?.tagName === 'TEMPLATE' &&
			(childNode.hasAttribute('loading') || childNode.hasAttribute('error'));

		if (isStateMarker) {
			branchObj[currentState] = createComponent(currentNodes, bindingValues, parentScopeClass);
			currentNodes = [];
			currentState = childNode.hasAttribute('loading') ? 'loading' : 'error';
		} else {
			currentNodes.push(childNode);
		}
	}

	if (currentNodes.length > 0) {
		branchObj[currentState] = createComponent(currentNodes, bindingValues, parentScopeClass);
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
					return resource[capturedState];
				}
			};
		});
};


const listComponentCache = new Map();

const listHandler = (node, bindingValues, name) => {
	const iteratorName = name.substring(5);
	let func;

	let callback = (bindingValue, node, bindingValues, context, bindingIndex, parentName, trackedEffect) => {
		// Create a unique but compact template key using parent info and binding index
		const templateKey = `${parentName}-${iteratorName}-${bindingIndex}`;
		const parentScopeClass = context.__parentScopeClass || parentName || null;

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

			// Create the component definition once with parent scope
			componentName = token(() => html([], ...bindingValues), {
				template,
				...listBindings,
				parentScopeClass
			});

			// Store in cache for future use
			listComponentCache.set(templateKey, componentName);
		}

		const length = computed(() => bindingValue.v.length);
		const currentElements = [];
		const abortController = new AbortController();

		const effectToUse = trackedEffect || effect;
		const cleanup = effectToUse.UI(() => {
			// Clean up previous elements properly
			while (currentElements.length > 0) {
				const element = currentElements.pop();
				if (element && element.remove) {
					element.remove();
				}
			}

			// Clear any remaining content
			node.innerHTML = '';
			bindingValue = convertToSignal(bindingValue);

			for (let i = 0; i < length.v; i++) {
				const componentElement = document.createElement(componentName);
				currentElements.push(componentElement);
				const itemContext = {
					[iteratorName]: bindingValue[i],
					[iteratorName + "Index"]: i,
					...context
				};
				// Only add __parentScopeClass if it exists
				if (parentScopeClass) {
					itemContext.__parentScopeClass = parentScopeClass;
				}
				waitOverride(componentElement, () =>
					componentElement.setContext(itemContext),
					abortController.signal
				);
				node.appendChild(componentElement);
			}
		});

		// If not using trackedEffect, return cleanup function manually
		if (!trackedEffect) {
			return () => {
				abortController.abort();
				while (currentElements.length > 0) {
					const element = currentElements.pop();
					if (element && element.remove) {
						element.remove();
					}
				}
				if (cleanup && typeof cleanup === 'function') {
					cleanup();
				}
			};
		}

		// If using trackedEffect, register abort cleanup
		if (trackedEffect) {
			trackedEffect(() => abortController.abort());
		}
		// trackedEffect already tracked the effect cleanup
	};

	const fullReplacementPlaceholder = new RegExp(FULL_REPLACEMENT_PLACEHOLDER.source);
	const match = node.getAttribute(`each:${iteratorName}`).match(fullReplacementPlaceholder);
	if (match) {
		const index = parseInt(match[1], 10);
		node.removeAttribute(name);
		return (bindingValues, node, context, parentName, trackedEffect) => callback(convertToSignal(bindingValues[index], context), node, bindingValues, context, index, parentName, trackedEffect);
	}
	return func;
};

const createTemplateFromLiteral = (strings, ...bindingValues) => {
	let templateString = strings.reduce((acc, str, i) => {
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

	// ========== PREPROCESSING STEP ==========
	// Transform self-closing void elements
	templateString = templateString.replace(
		/<(br|hr|img|input|embed|source|track|wbr)(\s+[^>]*?)?\s*\/>/gi,
		'<$1$2>'
	);

	// Transform conditional directives to template tags
	templateString = templateString.replace(
		/<:(else|error|loading)(?:\s+if\s*=\s*(\'\{\{--\d+--\}\}\'?))?\s*\/?>/g,
		(match, directive, condition) =>
			directive === 'else' && condition
				? `<template elseif=${condition}></template>`
				: `<template ${directive}></template>`
	);

	// Transform all other self-closing tags to have closing tags
	templateString = templateString.replace(/<([a-zA-Z][a-zA-Z0-9-]*)\s*([^>]*?)\s*\/>/g, '<$1 $2></$1>');

	// ========== END PREPROCESSING ==========

	// Check if template starts with <style> - this causes parsing issues
	if (templateString.trim().toLowerCase().startsWith('<style')) {
		throw new Error('Template cannot start with <style> element due to browser HTML parser quirks. Please place <style> after other elements.');
	}

	const template = document.createElement('template');
	template.innerHTML = templateString;

	return template.content;
};

// A tagged template literal function to create signal containing a url that auto updates from a template string
const url = (strings, ...values) => {
	const signals = values.map(convertToSignal);
	return computed(() => {
		let url = strings[0];
		for (let i = 0; i < values.length; i++) {
			url += encodeURIComponent(signals[i].v) + (strings[i + 1] || '');
		}
		return url;
	});
};

const registeredComponentList = new Set();

const component = (name, factory, bypass = {}) => {
	if (registeredComponentList.has(name)) {
		console.warn(`Component with name ${name} already exists`);
		return;
	}

	registeredComponentList.add(name);

	// Shared component data will be stored here or retrieved from cache
	let sharedData = null;
	let templateHash = null;

	customElements.define(name, class extends HTMLElement {
		#props = {};
		#mountHooks = [];
		#unmountHooks = [];
		#content = null;
		#templateRendererCalled = false;
		#additionalContext = null;

		constructor() {
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

			// Note: #props are now computed values (read-only) or passed-through signals (from :attr)
			// No need to convert them - setAttribute already handles this

			const context = {
				lifeCycle: {
					onMount: (fn) => this.#mountHooks.push(fn),
					onUnmount: (fn) => this.#unmountHooks.push(fn),
				},
				html: (strings, ...bindingValues) => this.#templateRenderer(strings, bindingValues),
				url,
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

			if (!sharedData) {
				this.#prepareTemplate(strings, bindingValues);
			}

			this.#generateCopy(bindingValues);
		};

		#generateCopy = async (bindingValues) => {
			const copy = sharedData.template.cloneNode(true);

			// Merge additional context with parent scope info
			const contextWithScope = {
				...this.#additionalContext,
				__parentScopeClass: this.#additionalContext?.__parentScopeClass || name
			};

			// trackedCleanupEffect automatically adds all cleanups to #unmountHooks
			await applyBindings(sharedData.bindings, bindingValues, copy, contextWithScope, name, this.#trackedCleanupEffect);

			const slotElements = Object.fromEntries(sharedData.slots.map(([slotName, index]) => [slotName, getNodeAtIndex(index, copy)]));

			const plugs = {};

			// Collect slot content from light DOM children
			for (const child of this.children) {
				const slotName = child.getAttribute('slot') || 'default';
				if (!slotElements[slotName]) {
					console.warn(`No matching slot "${slotName}" found for:`, child);
					child.remove();
				} else {
					if (!plugs[slotName]) plugs[slotName] = [];
					plugs[slotName].push(child);
				}
			}

			// Replace default slot content with provided content
			for (const [slotName, children] of Object.entries(plugs)) {
				const slotElement = slotElements[slotName];
				if (slotElement) {
					// Clear default content and configure for slotting
					slotElement.textContent = '';
					slotElement.style.display = 'contents';
					// Move children into slot
					for (const child of children) {
						slotElement.appendChild(child);
					}
				}
			}

			// Only append styles on first instance (check if already in DOM)
			if (sharedData.styleElement && !sharedData.styleElement.parentNode) {
				document.head.appendChild(sharedData.styleElement);
			}
			if (sharedData.globalStyleElement && !sharedData.globalStyleElement.parentNode) {
				document.head.appendChild(sharedData.globalStyleElement);
			}

			this.#content = copy;
			this.appendChild(this.#content);
			this.#mountHooks.forEach(hook => hook());
		};

		//public and utility methods

		#prepareTemplate = (strings, bindingValues) => {
			const templateContent = createTemplateFromLiteral(strings, ...bindingValues);

			// Create a temporary template element to get innerHTML for hashing
			const tempTemplate = document.createElement('template');
			tempTemplate.content.appendChild(templateContent.cloneNode(true));
			const templateString = tempTemplate.innerHTML;

			// Generate hash from the template string
			templateHash = hashTemplateString(templateString);

			// Check if we already have this template cached
			if (templateCache.has(templateHash)) {
				sharedData = templateCache.get(templateHash);
				// Add this component name to the list of components sharing this template
				sharedData.componentNames.add(name);
				sharedData.instanceCount++;
				return;
			}

			// This is a new template, prepare it
			const { bindings: foundBindings, slots: foundSlots, styleElements } = findTemplateBindings(templateContent, bindingValues);

			// Use parent scope class if this is an anonymous component
			const useParentScope = bypass?.parentScopeClass;

			let styleElement = null;
			let globalStyleElement = null;
			let scopeClassName = null;

			// Handle styles
			if (styleElements.length > 0 && !useParentScope) {
				const combinedStyles = styleElements
					.filter(style => !style.hasAttribute('global'))
					.map(style => style.textContent)
					.join('\n');

				// Use the hash for scoping instead of component name
				const { combinedStylesScoped, scopeClass } = scopeCSS(combinedStyles, `hash-${templateHash}`);

				scopeClassName = scopeClass;

				styleElement = document.createElement('style');
				styleElement.setAttribute('data-component', name);
				styleElement.setAttribute('data-hash', templateHash);
				styleElement.textContent = combinedStylesScoped;

				const combinedGlobalStyles = styleElements
					.filter(style => style.hasAttribute('global'))
					.map(style => style.textContent)
					.join('\n');

				globalStyleElement = document.createElement('style');
				globalStyleElement.setAttribute('data-component', name);
				globalStyleElement.setAttribute('data-hash', templateHash);
				globalStyleElement.setAttribute('global', '');
				globalStyleElement.textContent = combinedGlobalStyles;

				// Remove style elements from template
				styleElements.forEach(style => style.remove());
			} else if (useParentScope) {
				// Use parent's scope class for anonymous components
				scopeClassName = useParentScope;
				// Remove style elements but don't create new ones
				styleElements.forEach(style => style.remove());
			}

			// Only walk and add classes if we actually have a scope class
			if (scopeClassName) {
				const walk = (fragment) => {
					Array.from(fragment.childNodes).forEach(node => {
						if (node.nodeType === Node.ELEMENT_NODE) {
							node.classList.add(scopeClassName);
							walk(node);
						}
					});
				};

				walk(templateContent);
			}

			// Create shared data object and cache it
			sharedData = {
				template: templateContent,
				bindings: foundBindings,
				slots: foundSlots,
				styleElement,
				globalStyleElement,
				scopeClassName,
				instanceCount: 1,
				componentNames: new Set([name])
			};

			// If bypass had a template, use it instead
			if (bypass?.template) {
				sharedData.template = bypass.template;
			}
			if (bypass?.bindings) {
				sharedData.bindings = bypass.bindings;
			}
			if (bypass?.slots) {
				sharedData.slots = bypass.slots;
			}

			templateCache.set(templateHash, sharedData);
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

			// For :attr syntax - pass through directly
			if (bind) {
				this.#props[name] = value; // Direct assignment (signal/function/primitive)
				// Store marker in DOM for functions, otherwise store the signal's current value
				const domValue = typeof value === 'function' ? 'functionAttribute' : (isSignal(value) ? value.v : value);
				super.setAttribute(name, domValue);
				// Keep DOM in sync with signal changes
				if (isSignal(value)) {
					effect(() => super.setAttribute(name, value.v));
				}
				return;
			}

			// For non-: attr - create read-only computed values
			const type = isSignal(value) ? 'signal' : typeof value;

			// Convert functions and signals to read-only computed
			if (type === 'function' || type === 'signal') {
				if (!this.#props[name]) {
					// Create read-only computed that unwraps signal/function
					this.#props[name] = computed(() => {
						if (isSignal(value)) return value.v;
						if (typeof value === 'function') return value();
						return value;
					});
					// Keep DOM in sync
					effect(() => super.setAttribute(name, this.#props[name].v));
				}
			} else {
				// For primitives, create read-only computed that returns the value
				if (!this.#props[name]) {
					this.#props[name] = computed(() => value);
					effect(() => super.setAttribute(name, this.#props[name].v));
				}
			}
		}

		getAttribute(name, raw = false) {
			if (raw) return this.#props[name] ?? super.getAttribute(name);
			else return this.#props[name]?.v ?? super.getAttribute(name);
		}

		connectedCallback() {
			this.style.display = 'contents';

			if (this.getAttribute('render') === '') {
				this.#prepareContent();
			}
		}

		disconnectedCallback() {
			if (sharedData) {
				sharedData.instanceCount--;
				// Defer style removal to avoid flicker if a new instance is created immediately
				if (sharedData.instanceCount === 0) {
					queueMicrotask(() => {
						if (sharedData.instanceCount === 0) {
							sharedData.styleElement?.remove();
							sharedData.globalStyleElement?.remove();
							// Optionally remove from cache to free memory
							// templateCache.delete(templateHash);
						}
					});
				}
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
		// For anonymous components with bypass template, use hash-based naming
		if (bypassOrFactory?.template) {
			const tempTemplate = document.createElement('template');
			tempTemplate.content.appendChild(bypassOrFactory.template.cloneNode(true));
			const templateString = tempTemplate.innerHTML;
			const templateHash = hashTemplateString(templateString);
			const name = `tok-${templateHash}`;

			// If component with this hash already exists, return existing name
			if (registeredComponentList.has(name)) {
				return name;
			}
			return component(name, factoryOrString, bypassOrFactory);
		}

		// For components without bypass template, generate random name
		// (template will be hashed later in #prepareTemplate)
		let name;
		do name = `tok-${randomId()}-${randomId()}`;
		while (registeredComponentList.has(name));
		return component(name, factoryOrString, bypassOrFactory);
	}
	console.error('Invalid arguments passed to token()', factoryOrString, bypassOrFactory, bypass);
};

export {
	token as default,
	token,
	signal,
	computed,
	effect as dirtyEffect,
	url,
};
