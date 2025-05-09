import { UIeffect, effect, signal, bound, computed } from './signal.js';

const isSignal = (obj) => typeof obj === 'object' && obj !== null && 'v' in obj;
const isWebComponent = (element) => element instanceof HTMLElement && element.tagName.includes('-');

function sanitize(string) {
	const map = {
		'&': '&amp;',
		'<': '&lt;',
		'>': '&gt;',
		'"': '&quot;',
		"'": '&#x27;',
		"/": '&#x2F;',
	};
	const reg = /[&<>"'/]/ig;
	return string.replace(reg, (match) => (map[match]));
}

const ifStringSanitize = (value) => (typeof value === 'string' ? sanitize(value) : value) ?? '';

const findTemplateBindings = (node, bindingValues, currentNodeIndex = []) => {
	const fullReplacementPlaceholder = /\{\{--(\d+)--\}\}/;
	const partialReplacementPlaceholder = /\'\{\{--(\d+)--\}\}\'/g;

	let bindingFunctions = [];
	let slots = [];
	let plugs = [];

	switch (node.nodeType) {
		// handle text nodes and comments
		case Node.TEXT_NODE:
		case Node.COMMENT_NODE:
			if (partialReplacementPlaceholder.test(node.nodeValue)) {
				const { parts, indices } = splitTemplate(node.nodeValue, bindingValues);
				bindingFunctions.push((bindingValues, node) => {
					const expressions = [];
					for (const index of indices) {
						expressions.push(bindingValues[index]);
					}
					UIeffect(() => {
						let newValue = '';
						let index = 0;
						for (const part of parts) {
							newValue += part + ifStringSanitize(expressions[index]?.v) ?? '';
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
			}

			for (const { name, value } of attributes) {
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
				} else if (name === ":this") {
					const match = value.match(fullReplacementPlaceholder);
					if (match) {
						const index = parseInt(match[1], 10);
						bindingFunctions.push((bindingValues, node) => {
							if (isSignal(bindingValues[index])) {
								bindingValues[index].v = node;
							} else {
								console.error('to save a reference to the element, a signal must be passed as an bindingValueument');
							}
							node.removeAttribute(name);
						});
					}
				} else if (name === "slot") {
					plugs.push([value, currentNodeIndex]);
				} else if (name.startsWith(':')) { // handle bound attributes
					const match = value.match(fullReplacementPlaceholder);
					if (match) {
						const index = parseInt(match[1], 10);
						bindingFunctions.push((bindingValues, node) => {
							if (isSignal(bindingValues[index])) {
								createTwoWayBinding(node, name.substring(1), bindingValues[index]);
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
								expressions.push(bindingValues[index]);
							}
							UIeffect(() => {
								let newValue = '';
								let index = 0;
								for (const part of parts) {
									newValue += part + ifStringSanitize(expressions[index]?.v) ?? '';
									index++;
								}
								node.setAttribute(name, newValue);
							});
						});
					} else if (fullReplacementPlaceholder.test(value)) { // handle full replacement
						const match = value.match(fullReplacementPlaceholder);
						const index = parseInt(match[1], 10);
						// Handle function binding
						if (typeof bindingValues[index] === 'function') {
							bindingFunctions.push((bindingValues, node) => {
								node.setAttribute(name, bindingValues[index], true);
							});
						}
						else {
							bindingFunctions.push((bindingValues, node) => {
								const bindingValue = bindingValues[index];
								UIeffect(() => {
									const replacement = isSignal(bindingValue) ? bindingValue.v : bindingValue;
									node.setAttribute(name, ifStringSanitize(replacement));
								});
							});
						}
					}
				}
			}
	}

	const bindings = bindingFunctions.length ? [{ index: currentNodeIndex, bindingFunctions }] : [];

	for (let i = 0; i < node.childNodes.length; i++) {
		const { bindings: childBindings, slots: childSlots, plugs: childPlugs } = findTemplateBindings(node.childNodes[i], bindingValues, [...currentNodeIndex, i]);
		bindings.push(...childBindings);
		slots.push(...childSlots);
		plugs.push(...childPlugs);
	}

	return { bindings, slots, plugs };
};

const createTwoWayBinding = (element, boundAttrName, sig) => {
	// Handle signal changes
	if (!isWebComponent(element)) {
		// Handle attribute changes
		element.addEventListener('input', (e) => {
			sig.v = element[boundAttrName];
		});
		UIeffect(() => {
			element[boundAttrName] = sig.v;
		});
	}
	else {
		element.setAttribute(boundAttrName, sig, true);
	}
};

const applyBindings = (bindings, bindingValues, origin) => {
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
									func(bindingValues, element);
									resolve();
								});
							}));
						}
						await Promise.all(bindingPromises);
						element.setAttribute('bindings', 'done');
					} else if (attempts < 10) queueMicrotask(() => tryApplyBinding(attempts + 1));
					else console.error(`Failed to apply binding on ${element.tagName}`);
				};
				tryApplyBinding();
			} else {
				for (const func of bindingFunctions) {
					func(bindingValues, element);
				}
			}
		}
	}
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
	}, '');

	const template = document.createElement('template');
	template.innerHTML = templateString;

	return template.content;
};

const registeredComponentList = new Set();

//testing batches:
// Add at the top of component.js
const BATCH_SIZE = 5; // Number of methods to process in each batch
const BATCH_DELAY = 16; // Milliseconds between batches (roughly 1 frame)
let pendingRenders = new Set();
let isProcessingBatch = false;

const processBatch = () => {
    if (isProcessingBatch || pendingRenders.size === 0) return;
    
    isProcessingBatch = true;
    const currentBatch = Array.from(pendingRenders).slice(0, BATCH_SIZE);
    
    // Process current batch
    currentBatch.forEach(renderFn => {
        pendingRenders.delete(renderFn);
        renderFn();
    });
    
    isProcessingBatch = false;
    
    // If there are more renders pending, schedule next batch
    if (pendingRenders.size > 0) {
        setTimeout(processBatch, BATCH_DELAY);
    }
};

const component = (name, factory) => {
	if (registeredComponentList.has(name)) {
		console.warn(`Component with name ${name} already exists`);
		return;
	}

	registeredComponentList.add(name);

	let template = null;
	let bindings = [];
	let slots = {};
	let plugs = {};
	let id = '';

	customElements.define(name, class extends HTMLElement {
		_props = {};
		_mountHooks = [];
		_unmountHooks = [];
		_iterators = {}; //iterator object, contains all iterators to be used in list rendering
		_content = null;

		constructor() {
			super();
			this.id = Math.random().toString(36).substring(7);
			console.time(`${name} constructor ${this.id}`);
			this.style.display = 'contents';
			//this.#initializeProps();
			if (this.getAttribute('bindings') === 'done') {
				this.#prepareContent();
			}
		}

		#prepareContent() {
			Array.from(this.attributes).forEach(({ name, value }) => {
				if (name === 'bindings' && value === 'done') {
					return;
				} else this.setAttribute(name, value);
			});

			const props = {
				...this._props,
				onMount: (fn) => this._mountHooks.push(fn),
				onUnmount: (fn) => this._unmountHooks.push(fn),
				html: this.#templateRenderer,
				i: this._iterators,
			};

			for (const [key, value] of Object.entries(props)) {
				if (typeof value !== 'function' && !isSignal(value)) {
					props[key] = signal(value);
				}
			}

			const proxyProps = new Proxy(props, {
				//list all props that are accessed to check if they are set in the custom element in the html page
				get(target, prop, receiver) {
					if (!(prop in target)) {
						console.warn(`Property ${prop} is not set in the custom element`);
					}
					//return target[prop];
					return Reflect.get(...arguments);
				}
			});
			factory(proxyProps);
		}

		#templateRenderer = (strings, ...bindingValues) => {
			if (!template) {
				console.time(`${name} createTemplateFromLiteral ${this.id}`);
				this.#prepareTemplate(strings, bindingValues);
				console.timeEnd(`${name} createTemplateFromLiteral ${this.id}`);
			}

			//console.time(`${name} generateCopy ${this.id}`);
			this.#generateCopy(bindingValues);
			//console.timeEnd(`${name} generateCopy ${this.id}`);
		};

		#generateCopy = (bindingValues) => {
			const copy = template.cloneNode(true);

			//the code from here
			applyBindings(bindings, bindingValues, copy);

			for (const child of Array.from(this.children)) {
				const slotName = child.getAttribute('slot') || 'default';
				if (!slots[slotName]) {
					console.warn(`No matching slot "${slotName}" found for:`, child);
					child.remove();
				} else {
					const slotElement = getNodeAtIndex(slots[slotName], copy);
					slotElement.style.display = 'contents';
					slotElement.appendChild(child);
				}
			};

			this._content = copy;
			this.appendChild(this._content);
			this._mountHooks.forEach(hook => hook());
			console.timeEnd(`${name} constructor ${this.id}`);
		};

		//public and utility methods

		#prepareTemplate = (strings, bindingValues) => {
			template = createTemplateFromLiteral(strings, ...bindingValues);
			const { bindings: foundBindings, slots: foundSlots, plugs: foundPlugs } = findTemplateBindings(template, bindingValues);

			bindings = foundBindings;
			slots = Object.fromEntries(foundSlots);
			plugs = Object.fromEntries(foundPlugs);
		}

		setAttribute(name, value, bind = false) {
			if (name === 'bindings' && value === 'done') {
				//this.#prepareContent();
				//this._props[name] = signal(value);
				//return;

				// Queue the render instead of immediate execution
				pendingRenders.add(()=>this.#prepareContent());
				queueMicrotask(processBatch);
				this._props[name] = signal(value);
				return;
			}

			const type = isSignal(value) ? 'signal' : typeof value;

			if (type === 'function') {
				this._props[name] = value;
				return;
			}

			if (!this._props[name]) {
				this._props[name] = signal(value);
			}

			if (type === 'signal') {
				super.setAttribute(name, value.v);
				if (bind) this._props[name] = value;
				else this._props[name].v = value.v;
			} else {
				super.setAttribute(name, value);
				this._props[name].v = value;
			}
		}

		connectedCallback() {
		}

		disconnectedCallback() {
			this._unmountHooks.forEach(hook => hook());
		}
	});
};

export { component };