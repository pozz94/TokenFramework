import { signal, computed, effect, isSignal } from './signal.js';

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
				slots.push([node.getAttribute('name') ?? 'default', currentNodeIndex]);
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

	if (generatedSubComponent) return { bindings, slots, styleElements };

	for (let i = 0; i < node.childNodes.length; i++) {
		const { bindings: childBindings, slots: childSlots, styleElements: childStyles } = findTemplateBindings(node.childNodes[i], bindingValues, [...currentNodeIndex, i]);
		bindings.push(...childBindings);
		slots.push(...childSlots);
		styleElements.push(...childStyles);
	}

	return { bindings, slots, styleElements };
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
	for (const node of nodes) { template.content.appendChild(node.cloneNode(true)); };

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
			condition: branch.conditionGenerator(bindingValues, context, branch.conditionIndex, branch.state)
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
	}

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
}

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
				state: capturedState,
				component: branchObj[capturedState],
				conditionGenerator: function (bindingValues, context, resourceIndex, state) {
					const resource = convertToSignal(bindingValues[resourceIndex], context);
					return computed(() => resource[state].v);
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
		_props = {};
		_mountHooks = [];
		_unmountHooks = [];
		_content = null;
		_templateRendererCalled = false;
		_additionalContext = null;

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
				else if (!this._props.hasOwnProperty(name)) this.setAttribute(name, value === '' ? true : value);
			});

			for (const [key, value] of Object.entries(this._props)) {
				if (typeof value !== 'function' && !isSignal(value)) {
					this._props[key] = signal(value);
				}
			}

			const context = {
				lifeCycle: {
					onMount: (fn) => this._mountHooks.push(fn),
					onUnmount: (fn) => this._unmountHooks.push(fn),
				},
				html: (strings, ...bindingValues) => this.#templateRenderer(strings, bindingValues, this._additionalContext),
				signal,
				computed,
				effect: this.#trackedCleanupEffect
			};

			const proxyProps = new Proxy(this._props, {
				//list all props that are accessed to check if they are set in the custom element in the html page
				get(target, prop) {
					prop = prop.toLowerCase();
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
			this._unmountHooks.push(cleanup);
			return cleanup;
		};

		#trackedCleanupEffect = new Proxy(this.#createTrackedEffect(effect), {
			get: (_, prop) => {
				if (prop === 'untrack') return effect.untrack;
				const effectFn = effect[prop];
				if (typeof effectFn === 'function') {
					return this.#createTrackedEffect(effectFn);
				}
				return effectFn;
			}
		});

		#templateRenderer = (strings, bindingValues) => {
			if (this._templateRendererCalled === true) {
				console.error('html() can only be called once inside a component');
				return;
			}
			this._templateRendererCalled = true;

			if (!template) {
				this.#prepareTemplate(strings, bindingValues);
			}

			this.#generateCopy(bindingValues);
		};

		#generateCopy = async (bindingValues) => {
			const copy = template.cloneNode(true);

			const cleanups = await applyBindings(bindings, bindingValues, copy, this._additionalContext, name);
			this._unmountHooks.push(...cleanups);

			const slotElements = Object.fromEntries(slots.map(([slotName, index]) => [slotName, getNodeAtIndex(index, copy)]));

			const plugs = {}

			for (const child of Array.from(this.children)) {
				const slotName = child.getAttribute('slot') || 'default';
				if (!slotElements[slotName]) {
					console.warn(`No matching slot "${slotName}" found for:`, child);
					child.remove();
				} else {
					if (!plugs[slotName]) plugs[slotName] = [];
					plugs[slotName].push(child);
				}
			};

			//replace default content from slots if there are plugs for them
			for (const [slotName, children] of Object.entries(plugs)) {
				if (slotElements[slotName]) {
					slotElements[slotName].innerHTML = '';
					slotElements[slotName].style.display = 'contents';
					children.forEach(child => slotElements[slotName].appendChild(child));
				}
			}


			this._content = copy;
			this.appendChild(this._content);
			this._mountHooks.forEach(hook => hook());
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
			this._additionalContext = context;
			this.#prepareContent();
		}

		setAttribute(name, value, bind = false) {
			if (name === 'render' && value === true) {
				this.#prepareContent();

				return;
			}

			const type = isSignal(value) ? 'signal' : typeof value;

			if (type === 'function') {
				this._props[name] = value;
				super.setAttribute(name, 'functionAttribute');
				return;
			}

			if (!this._props[name] && !bind) {
				this._props[name] = signal(value);
				effect(() => super.setAttribute(name, this._props[name].v));
			}

			if (type === 'signal') {
				super.setAttribute(name, value.v);
				if (!bind) this._props[name].v = value.v;
				else {
					this._props[name] = value;
					effect(() => super.setAttribute(name, this._props[name].v));
				};
			} else {
				super.setAttribute(name, value);
				this._props[name].v = value;
			}

			//effect(() => super.setAttribute(name, this._props[name].v)); //possibly duplicated from when the attribute was set the previous time
		}

		getAttribute(name, raw = false) {
			if (raw) return this._props[name] ?? super.getAttribute(name);
			else return this._props[name]?.v ?? super.getAttribute(name);
		}

		connectedCallback() {
			this._id = randomId();
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
			this._unmountHooks.forEach(hook => hook());
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

export {
	token as default,
	token,
	signal,
	computed,
	effect as dirtyEffect,
};