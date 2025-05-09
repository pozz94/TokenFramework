import { signal, computed, effect, bound } from './signal.js';

const isSignal = (obj) => typeof obj === 'object' && obj !== null && 'v' in obj;
const isWebComponent = (element) => element instanceof HTMLElement && element.tagName.includes('-');

const convertToSignal = (value) => {
	if (isSignal(value)) return value;
	if (typeof value === 'function') return computed(value);
	return signal(value);
};

const sanitizeHTML = (html) => {
	const element = document.createElement('div');
	element.textContent = html;
	return element.innerHTML;
};

const findTemplateBindings = (node, bindingValues, currentNodeIndex = []) => {
	const fullReplacementPlaceholder = /\{\{--(\d+)--\}\}/;
	const partialReplacementPlaceholder = /\'\{\{--(\d+)--\}\}\'/g;

	let bindingFunctions = [];
	let slots = [];
	let plugs = [];
	let styleElements = [];

	let isConditional = false;

	const handleFullReplacementAndPush = (name, value, callback) => {
		const fullReplacementPlaceholder = /\{\{--(\d+)--\}\}/;
		const match = value.match(fullReplacementPlaceholder);
		if (match) {
			const index = parseInt(match[1], 10);
			bindingFunctions.push((bindingValues, node) => callback(bindingValues[index], node));
			node.removeAttribute(name);
		}
		return match !== null;
	};

	switch (node.nodeType) {
		// handle text nodes and comments
		case Node.TEXT_NODE:
		case Node.COMMENT_NODE:
			if (partialReplacementPlaceholder.test(node.nodeValue)) {
				if (node.parentElement.tagName === 'STYLE') {
					console.error("Style elements can't have bound state since they are added only once to the head of the document for all components of the same type");
					break;
				}
				const { parts, indices } = splitTemplate(node.nodeValue);
				bindingFunctions.push((bindingValues, node) => {
					const expressions = [];
					for (const index of indices) {
						expressions.push(convertToSignal(bindingValues[index]));
					}
					return effect.UI(() => {
						let newValue = '';
						let index = 0;
						for (const part of parts) {
							newValue += part + (expressions[index]?.v ?? '');
							index++;
						}
						node.nodeValue = newValue;
					});
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
				return { bindings: [], slots: [], plugs: [], styleElements };
			} else if (node.tagName === 'W') {
				bindingFunctions.push((bindingValues, node) => {
					node.style.display = 'contents';
				});
			}

			for (const { name, value } of attributes) {
				if (value.includes('{{--')) {
					if (name.startsWith('on')) { // handle event attributes
						handleFullReplacementAndPush(name, value, (bindingValue, node) => {
							if (typeof bindingValue === 'function') {
								node.addEventListener(name.substring(2).toLowerCase(), bindingValue);
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
						handleFullReplacementAndPush(name, value, (bindingValue, node) => {
							if (typeof bindingValue === 'function') {
								bindingValue(node);
							} else {
								console.error('apply accepts only functions as an argument');
							}
						});
					} else if (name.startsWith(':')) { // handle bound attributes
						handleFullReplacementAndPush(name, value, (bindingValue, node) => {
							if (isSignal(bindingValue)) {
								return createTwoWayBinding(node, name.substring(1), bindingValue);
							} else {
								console.error('bound attribute must be a signal');
							}
						});
					} else if (name === "slot") {
						plugs.push([value, currentNodeIndex]);
					} else if (name === "if") {
						isConditional = true;
						bindingFunctions.push(conditionalHandler(node, bindingValues));
					} else {
						if (partialReplacementPlaceholder.test(value)) { // handle partial replacement
							const { parts, indices } = splitTemplate(value);
							bindingFunctions.push((bindingValues, node) => {
								const expressions = [];
								for (const index of indices) {
									expressions.push(convertToSignal(bindingValues[index]));
								}
								return effect.UI(() => {
									let newValue = '';
									let index = 0;
									for (const part of parts) {
										newValue += part + (expressions[index]?.v ?? '');
										index++;
									}
									node.setAttribute(name, newValue);
								});
							});
						} else if (fullReplacementPlaceholder.test(value)) { // handle full replacement
							handleFullReplacementAndPush(name, value, (bindingValue, node) => {
								if (typeof bindingValue === 'function' && isWebComponent(node)) {
									node.setAttribute(name, bindingValue, true);
								}
								else {
									const bindingValueSignal = convertToSignal(bindingValue);
									return effect.UI(() => {
										const replacement = isSignal(bindingValueSignal) ? bindingValueSignal.v : bindingValueSignal;
										node.setAttribute(name, replacement);
									});
								}
							});
						}
					}
				}
			}
	}

	if (isWebComponent(node)) bindingFunctions.push((bindingValues, node) => { node.setAttribute('render', true); });

	const bindings = bindingFunctions.length ? [{ index: currentNodeIndex, bindingFunctions }] : [];

	if (isConditional) return { bindings, slots, plugs, styleElements };

	for (let i = 0; i < node.childNodes.length; i++) {
		const { bindings: childBindings, slots: childSlots, plugs: childPlugs, styleElements: childStyles } = findTemplateBindings(node.childNodes[i], bindingValues, [...currentNodeIndex, i]);
		bindings.push(...childBindings);
		slots.push(...childSlots);
		plugs.push(...childPlugs);
		styleElements.push(...childStyles);
	}

	return { bindings, slots, plugs, styleElements };
};

const createTwoWayBinding = (element, boundAttrName, sig) => {
	// Handle signal changes
	if (!isWebComponent(element)) {
		// Handle attribute changes
		element.addEventListener('input', (e) => {
			sig.v = element[boundAttrName];
		});
		return effect.UI(() => {
			element[boundAttrName] = sig.v;
		});
	}
	else {
		element.setAttribute(boundAttrName, sig, true);
	}
};

const applyBindings = async (bindings, bindingValues, origin) => {
	const cleanups = [];
	if (bindings.length) {
		for (const { index, bindingFunctions } of bindings) {
			const element = getNodeAtIndex(index, origin);
			if (isWebComponent(element)) {
				const tryApplyBinding = (attempts = 0) => {
					if (element.setAttribute !== HTMLElement.prototype.setAttribute) {
						for (const func of bindingFunctions) {
							const cleanup = func(bindingValues, element);
							if (cleanup && typeof cleanup === 'function') cleanups.push(cleanup);
						}
					} else if (attempts < 10) queueMicrotask(() => tryApplyBinding(attempts + 1));
					else console.error(`Failed to apply binding on ${element.tagName}`);
				};
				tryApplyBinding();
			} else {
				for (const func of bindingFunctions) {
					const cleanup = func(bindingValues, element);
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

const conditionalHandler = (node, bindingValues) => {
	const parseConditionValue = (attributeValue) => {
		const match = attributeValue.match(/\{\{--(\d+)--\}\}/);
		if (match) {
			const bindingIndex = parseInt(match[1], 10);
			return convertToSignal(bindingValues[bindingIndex]);
		}
		return signal(false);
	};

	const createConditionalComponent = (blockContent) => {
		const blockTemplate = document.createElement('template');
		for (const node of blockContent) {
			blockTemplate.content.appendChild(node.cloneNode(true));
		}

		const blockBindings = findTemplateBindings(blockTemplate.content, bindingValues);

		return token(() => html([], ...bindingValues), {
			template: blockTemplate.content,
			...blockBindings
		});
	};

	const childNodes = Array.from(node.childNodes);
	const conditionBranches = [];
	let currentBranchNodes = [];
	let branchCondition = parseConditionValue(node.getAttribute('if'));

	node.removeAttribute('if');

	for (const childNode of childNodes) {
		const isBranchSeparator = childNode.tagName === 'BR' &&
			(childNode.hasAttribute('else') || childNode.hasAttribute('elseif'));

		if (isBranchSeparator) {
			conditionBranches.push({
				condition: branchCondition,
				componentName: createConditionalComponent(currentBranchNodes)
			});

			currentBranchNodes = [];
			branchCondition = childNode.hasAttribute('elseif') ?
				parseConditionValue(childNode.getAttribute('elseif')) :
				signal(true);
		} else {
			currentBranchNodes.push(childNode);
		}
	}

	if (currentBranchNodes.length > 0) {
		conditionBranches.push({
			condition: branchCondition,
			componentName: createConditionalComponent(currentBranchNodes)
		});
	}

	return (bindingValues, node) => {
		effect.UI(() => {
			for (const branch of conditionBranches) {
				if (branch.condition.v === true) {
					const branchElement = document.createElement(branch.componentName);
					branchElement.setAttribute('render', true);
					node.innerHTML = '';
					node.appendChild(branchElement);
					break;
				}
			}
		});
	};
};

const createTemplateFromLiteral = (strings, ...bindingValues) => {
	const templateString = strings.reduce((acc, str, i) => {
		// If we're at the last string piece and no more values, just append it
		if (i >= bindingValues.length) {
			return acc + str;
		}
		//if value is not a signal or a function just append it
		if (!isSignal(bindingValues[i]) && typeof bindingValues[i] !== 'function') {
			const sanitizedValue = typeof bindingValues[i] === 'string'
				? sanitizeHTML(bindingValues[i])
				: bindingValues[i];
			return acc + str + sanitizedValue;
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
	let plugs = bypass?.plugs || [];

	customElements.define(name, class extends HTMLElement {
		_props = {};
		_mountHooks = [];
		_unmountHooks = [];
		_iterators = {}; //iterator object, contains all iterators to be used in list rendering
		_content = null;
		_templateRendererCalled = false;

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
				if (name === 'render' && value === '') {
					return;
				} else this.setAttribute(name, value === '' ? true : value);
			});

			for (const [key, value] of Object.entries(this._props)) {
				if (typeof value !== 'function' && !isSignal(value)) {
					this._props[key] = signal(value);
				}
			}

			const props = {
				...this._props,
			};

			const createTrackedEffect = (effectFn) => (...args) => {
				const cleanup = effectFn(...args);
				this._unmountHooks.push(cleanup);
				return cleanup;
			};

			const trackedCleanupEffect = new Proxy(createTrackedEffect(effect), {
				get(_, prop) {
					if (prop === 'untrack') return effect.untrack;
					const effectFn = effect[prop];
					if (typeof effectFn === 'function') {
						return createTrackedEffect(effectFn);
					}
					return effectFn;
				}
			});

			const context = {
				lifeCycle: {
					onMount: (fn) => this._mountHooks.push(fn),
					onUnmount: (fn) => this._unmountHooks.push(fn),
				},
				html: this.#templateRenderer,
				i: this._iterators,
				signal,
				computed,
				effect: trackedCleanupEffect,
				bound,
			};

			const proxyProps = new Proxy(props, {
				//list all props that are accessed to check if they are set in the custom element in the html page
				get(target, prop, receiver) {
					if (!(prop in target)) {
						console.warn(`Property ${prop} is not set in the custom element`);
					}
					return Reflect.get(...arguments);
				}
			});

			const scopedFactory = () => {
				Object.assign(globalThis, context);
				try {
					factory(proxyProps, context);
				} finally {
					Object.keys(context).forEach(key => { delete globalThis[key]; });
				}
			};

			scopedFactory();
		}

		#templateRenderer = (strings, ...bindingValues) => {
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

			const cleanups = await applyBindings(bindings, bindingValues, copy);
			this._unmountHooks.push(...cleanups);

			const plugElementsArray = plugs.map(([slotName, index]) => [slotName, getNodeAtIndex(index, copy)]);
			const slotElements = Object.fromEntries(slots.map(([slotName, index]) => [slotName, getNodeAtIndex(index, copy)]));

			for (const [slotName, plugElement] of plugElementsArray) {
				slotElements[slotName].style.display = 'contents';
				slotElements[slotName].appendChild(plugElement);
			}

			for (const child of Array.from(this.children)) {
				const slotName = child.getAttribute('slot') || 'default';
				if (!slots[slotName]) {
					console.warn(`No matching slot "${slotName}" found for:`, child);
					child.remove();
				} else {
					slotElements[slotName].style.display = 'contents';
					slotElements[slotName].appendChild(child);
				}
			};

			this._content = copy;
			this.appendChild(this._content);
			this._mountHooks.forEach(hook => hook());
		};

		//public and utility methods

		#prepareTemplate = (strings, bindingValues) => {
			template = createTemplateFromLiteral(strings, ...bindingValues);
			const { bindings: foundBindings, slots: foundSlots, plugs: foundPlugs, styleElements } = findTemplateBindings(template, bindingValues);

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
			plugs = foundPlugs;
		};

		setAttribute(name, value, bind = false) {
			if (name === 'render' && value === true) {
				this.#prepareContent();
				//this._props[name] = signal(value);
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

			effect(() => super.setAttribute(name, this._props[name].v)); //possibly duplicated from when the attribute was set the previous time
		}

		getAttribute(name, raw = false) {
			if (raw) return this._props[name] ?? super.getAttribute(name);
			else return this._props[name]?.v ?? super.getAttribute(name);
		}

		connectedCallback() {
			this.id = randomId();

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
		return component(`tok-${randomId()}-${randomId()}`, factoryOrString, bypassOrFactory);
	} else {
		console.error('Invalid arguments passed to token()', factoryOrString, bypassOrFactory, bypass);
	}
};

export {
	token as default,
	token,
	signal,
	computed,
	effect,
};