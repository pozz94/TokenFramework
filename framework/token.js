import { signal, computed, effect, bound } from './signal.js';

const isSignal = (obj) => typeof obj === 'object' && obj !== null && 'v' in obj;
const isWebComponent = (element) => element instanceof HTMLElement && element.tagName.includes('-');

const convertToSignal = (value) => {
	if (isSignal(value)) return value;
	if (typeof value === 'function') return computed(value);
	return signal(value);
};

const findTemplateBindings = (node, bindingValues, currentNodeIndex = []) => {
	const fullReplacementPlaceholder = /\{\{--(\d+)--\}\}/;
	const partialReplacementPlaceholder = /\'\{\{--(\d+)--\}\}\'/g;

	let bindingFunctions = [];
	let slots = [];
	let plugs = [];
	let styleElements = [];

	switch (node.nodeType) {
		// handle text nodes and comments
		case Node.TEXT_NODE:
		case Node.COMMENT_NODE:
			if (partialReplacementPlaceholder.test(node.nodeValue)) {
				if (node.parentElement.tagName === 'STYLE') {
					console.error("Style elements can't have bound state since they are added only once to the head of the document for all components of the same type");
					break;
				}
				const { parts, indices } = splitTemplate(node.nodeValue, bindingValues);
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
						const match = value.match(fullReplacementPlaceholder);
						if (match) {
							const index = parseInt(match[1], 10);
							bindingFunctions.push((bindingValues, node) => {
								if (typeof bindingValues[index] === 'function') {
									const eventName = name.substring(2).toLowerCase();
									node.addEventListener(eventName, bindingValues[index]);
								}
								node.removeAttribute(name);
							});
						}
					} else if (name === "slot") {
						plugs.push([value, currentNodeIndex]);
					} else if (name === ":this") {
						const match = value.match(fullReplacementPlaceholder);
						if (match) {
							const index = parseInt(match[1], 10);
							bindingFunctions.push((bindingValues, node) => {
								if (isSignal(bindingValues[index])) {
									bindingValues[index].v = node;
								} else {
									console.error('to save a reference to the element, a signal must be passed as an argument');
								}
								node.removeAttribute(name);
							});
						}
					} else if (name.startsWith(':')) { // handle bound attributes
						const match = value.match(fullReplacementPlaceholder);
						if (match) {
							const index = parseInt(match[1], 10);
							bindingFunctions.push((bindingValues, node) => {
								if (isSignal(bindingValues[index])) {
									node.removeAttribute(name);
									return createTwoWayBinding(node, name.substring(1), bindingValues[index]);
								} else {
									console.error('bound attribute must be a signal');
								}
								node.removeAttribute(name);
							});
						}
					} else {
						if (partialReplacementPlaceholder.test(value)) { // handle partial replacement
							const { parts, indices } = splitTemplate(value, bindingValues);
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
							const match = value.match(fullReplacementPlaceholder);
							const index = parseInt(match[1], 10);
							// Handle function binding
							if (typeof bindingValues[index] === 'function' && isWebComponent(node)) {
								bindingFunctions.push((bindingValues, node) => {
									node.setAttribute(name, bindingValues[index], true);
								});
							}
							else {
								bindingFunctions.push((bindingValues, node) => {
									const bindingValue = convertToSignal(bindingValues[index]);
									return effect.UI(() => {
										const replacement = isSignal(bindingValue) ? bindingValue.v : bindingValue;
										node.setAttribute(name, replacement);
									});
								});
							}
						}
					}
				}
			}
	}

	if(isWebComponent(node)) bindingFunctions.push((bindingValues, node) => { node.setAttribute('render', true); });

	const bindings = bindingFunctions.length ? [{ index: currentNodeIndex, bindingFunctions }] : [];

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
				const tryApplyBinding = async (attempts = 0) => {
					if (element.setAttribute !== HTMLElement.prototype.setAttribute) {
						const bindingPromises = [];
						for (const func of bindingFunctions) {
							bindingPromises.push(new Promise(resolve => {
								queueMicrotask(() => {
									const cleanup = func(bindingValues, element);
									if (cleanup && typeof cleanup === 'function') cleanups.push(cleanup);
									resolve();
								});
							}));
						}
						await Promise.all(bindingPromises);
					} else if (attempts < 10) queueMicrotask(() => tryApplyBinding(attempts + 1));
					else console.error(`Failed to apply binding on ${element.tagName}`);
				};
				await tryApplyBinding();
			} else {
				for (const func of bindingFunctions) {
					const cleanup = func(bindingValues, element)
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

function splitTemplate(str, bindingValues) {
	const partialReplacementPlaceholder = /\'\{\{--(\d+)--\}\}\'/g;

	const parts = [];
	const indices = [];
	let lastIndex = 0;
	const matches = [...str.matchAll(partialReplacementPlaceholder)];
	let temp = '';
	let notSignals = {};

	for (const match of matches) {
		const currentPart = str.slice(lastIndex, match.index);
		const index = parseInt(match[1], 10);
		const bindingValue = bindingValues[index];

		if (isSignal(bindingValue) || typeof bindingValue === 'function') {
			// If it is a signal, keep them separate
			parts.push(temp + currentPart);
			indices.push(index);
			temp = '';
		} else {
			// If not a signal, combine the bindingValue with the next part
			notSignals[match[0]] = bindingValue;

			temp += currentPart + bindingValue;
		}

		if (Object.keys(notSignals).length) {
			console.warn(
				str,
				'\nOne or more of the arguments here are not a signals, if you expect all of them to change reactively, make sure they are signals',
				'\nThose that are not signals will never update. Here are the non-signal values:\n',
				notSignals
			);
		}

		lastIndex = match.index + match[0].length;
	}
	parts.push(temp + str.slice(lastIndex));

	return { parts, indices };
}

const createTemplateFromLiteral = (strings, ...bindingValues) => {
	const templateString = strings.reduce((acc, str, i) => {
		//        // If we're at the last string piece and no more values, just append it
		if (i >= bindingValues.length) {
			return acc + str;
		}

		return acc + str + `'{{--${i}--}}'`;
	}, '').replace(/[^\S\r\n]+/g, ' ');

	const template = document.createElement('template');
	template.innerHTML = templateString;

	return template.content;
};

const registeredComponentList = new Set();

const component = (name, factory) => {
	if (registeredComponentList.has(name)) {
		console.warn(`Component with name ${name} already exists`);
		return;
	}

	registeredComponentList.add(name);

	let template = null;
	let styleElement = null;
	let instanceCount = 0;
	let bindings = [];
	let slots = [];
	let plugs = [];

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
			this.id = Math.random().toString(36).substring(7);
			console.time(`${name} render ${this.id}`);
			this.style.display = 'contents';

			if (this.getAttribute('render') === '') {
				this.#prepareContent();
			}
		}

		#prepareContent() {
			Array.from(this.attributes).forEach(({ name, value }) => {
				if (name === 'render' && value === '') {
					return;
				} else this.setAttribute(name, value===''?true:value);
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
				console.time(`${name} createTemplateFromLiteral ${this.id}`);
				this.#prepareTemplate(strings, bindingValues);
				console.timeEnd(`${name} createTemplateFromLiteral ${this.id}`);
			}

			//console.time(`${name} generateCopy ${this.id}`);
			this.#generateCopy(bindingValues);
			//console.timeEnd(`${name} generateCopy ${this.id}`);
		};

		#generateCopy = async (bindingValues) => {
			const copy = template.cloneNode(true);

			const cleanups = await applyBindings(bindings, bindingValues, copy);
			//console.log('cleanups:', cleanups);
			this._unmountHooks.push(...cleanups);

			//console.log('plugs:', plugs);

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
			console.timeEnd(`${name} render ${this.id}`);
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
		}

		setAttribute(name, value, bind = false) {
			if (name === 'render' && value === true) {
				this.#prepareContent();
				this._props[name] = signal(value);
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
				if (!bind) this._props[name].v = value.v
				else {
					this._props[name] = value
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
};

export {
	component as default,
	component as token,
	signal,
	computed,
	effect,
};