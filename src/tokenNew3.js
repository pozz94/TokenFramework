import { signal, computed, effect, isSignal } from './signalNew3.js';
import { scopeCSS } from './cssProcessing.js';
import { wrapInContext } from './utils.js';

// ============================================================================
// CONSTANTS & UTILITIES
// ============================================================================

const BOOLEAN_ATTRS = new Set([
	'checked', 'selected', 'disabled', 'readonly', 'required', 'hidden',
	'multiple', 'open', 'autofocus', 'loop', 'muted', 'controls', 'autoplay'
]);

// Reusable regex patterns (created once)
const FULL_PLACEHOLDER = /\{\{--(\d+)--\}\}/;
const PARTIAL_PLACEHOLDER = /'\{\{--(\d+)--\}\}'/;

// Fast hash function
const hash = (str) => {
	let h = 0;
	for (let i = 0; i < str.length; i++) {
		h = ((h << 5) - h) + str.charCodeAt(i) | 0;
	}
	return h.toString(36);
};

const randomId = () => Math.random().toString(36).slice(2, 7);
const isWebComponent = (el) => el instanceof HTMLElement && el.tagName.includes('-');

const sanitizeHTML = (value) => {
	if (typeof value !== 'string') return value;
	const el = document.createElement('div');
	el.textContent = value;
	return el.innerHTML;
};

// ============================================================================
// BINDING CONTEXT - Unified state management
// ============================================================================

class BindingContext {
	constructor(values, componentContext, trackedEffect, parentName, scopeClassName = null) {
		this.values = values;
		this.ctx = componentContext;
		this.effect = trackedEffect || effect;
		this.parent = parentName;
		this.scopeClassName = scopeClassName;
	}

	toSignal(value) {
		if (isSignal(value)) return value;
		if (typeof value === 'function') return computed(wrapInContext(value, this.ctx));
		return signal(value);
	}

	wrap(fn) {
		return wrapInContext(fn, this.ctx);
	}
}

// ============================================================================
// BINDING HANDLERS - Simplified, direct implementations
// ============================================================================

const Handlers = {
	// Text interpolation
	text(node, indices, parts, bctx) {
		const signals = indices.map(i => bctx.toSignal(bctx.values[i]));
		bctx.effect.UI(bctx.wrap(() => {
			const newValue = parts.map((p, i) => {
				let val = signals[i]?.v;
				// If the computed returns a signal, unwrap it
				if (isSignal(val)) {
					val = val.v;
				}
				return p + (val ?? '');
			}).join('');
			node.nodeValue = newValue;
		}));
	},

	// Event listener
	event(node, eventName, handler, bctx) {
		const wrapped = bctx.wrap(handler);
		const listener = (e) => wrapped(e);
		// Tie listener lifetime to component lifetime via tracked effect cleanup
		bctx.effect(() => {
			node.addEventListener(eventName, listener);
			return () => node.removeEventListener(eventName, listener);
		});
	},

	// :this ref
	ref(node, sig) {
		sig.v = node;
	},

	// apply directive
	apply(node, fn, bctx) {
		bctx.wrap(fn)(node);
	},

	// :attr two-way binding
	twoWay(node, attr, value, bctx) {
		if (isWebComponent(node))
			return node.setAttribute(attr, value, true);

		const sig = bctx.toSignal(value);

		const inputListener = (e) => {
			sig.v = e.target.type === 'number' || e.target.type === 'range'
				? Number(node[attr])
				: node[attr];
		};
		bctx.effect(() => {
			node.addEventListener('input', inputListener);
			return () => node.removeEventListener('input', inputListener);
		});
		return bctx.effect.UI(() => {
			node[attr] = sig.v;
		});
	},

	// Boolean attribute
	boolean(node, attr, value, bctx) {
		const sig = bctx.toSignal(value);
		bctx.effect.UI(bctx.wrap(() => node[attr] = sig.v));
	},

	// Attribute interpolation
	attrInterpolate(node, attr, indices, parts, bctx) {
		const signals = indices.map(i => bctx.toSignal(bctx.values[i]));

		if (attr === 'class') {
			bctx.effect.UI(bctx.wrap(() => {
				const reconstructed = parts.map((p, i) => p + (signals[i]?.v ?? '')).join('');
				const finalClass = bctx.scopeClassName ? `${bctx.scopeClassName} ${reconstructed}` : reconstructed;
				node.setAttribute(attr, finalClass);
			}));
		} else {
			bctx.effect.UI(bctx.wrap(() => {
				node.setAttribute(attr, parts.map((p, i) =>
					p + (signals[i]?.v ?? '')).join(''));
			}));
		}
	},

	// Simple attribute binding
	attrBind(node, attr, value, bctx) {
		if (isWebComponent(node)) {
			node.setAttribute(attr, value, false);
			return;
		}
		const sig = bctx.toSignal(value);

		if (attr === 'class' && bctx.scopeClassName) {
			const classSignal = computed(() => `${bctx.scopeClassName} ${sig.v}`);
			bctx.effect.UI(bctx.wrap(() => node.setAttribute(attr, classSignal.v)));
		} else {
			bctx.effect.UI(bctx.wrap(() => node.setAttribute(attr, sig.v)));
		}
	}
};

// ============================================================================
// TEMPLATE PARSER - Flatter structure
// ============================================================================

class TemplateParser {
	constructor(template, values) {
		this.template = template;
		this.values = values;
		this.bindings = [];
		this.slots = [];
		this.styles = [];
	}

	parse() {
		// Walk all child nodes of the DocumentFragment
		for (let i = 0; i < this.template.childNodes.length; i++) {
			this._walk(this.template.childNodes[i], [i]);
		}
		return {
			bindings: this.bindings,
			slots: this.slots,
			styleElements: this.styles
		};
	}

	_walk(node, path) {
		switch (node.nodeType) {
			case Node.TEXT_NODE:
			case Node.COMMENT_NODE:
				this._handleText(node, path);
				break;
			case Node.ELEMENT_NODE:
				this._handleElement(node, path);
				break;
		}
	}

	_handleText(node, path) {
		if (!PARTIAL_PLACEHOLDER.test(node.nodeValue)) return;
		if (node.parentElement?.tagName === 'STYLE') {
			console.error("Style elements can't have bound state");
			return;
		}

		const { parts, indices } = this._split(node.nodeValue);
		this.bindings.push({
			path,
			apply: (node, bctx) => Handlers.text(node, indices, parts, bctx)
		});
	}

	_handleElement(node, path) {
		// Handle special elements
		if (node.tagName === 'SLOT') {
			if (!node.hasAttribute('component')) {
				this.slots.push([node.getAttribute('name') ?? 'default', path]);
			}
			return;
		}

		if (node.tagName === 'STYLE') {
			this.styles.push(node);
			return;
		}

		if (node.tagName === 'W') {
			this.bindings.push({
				path,
				apply: (node) => node.style.display = 'contents'
			});
		}

		// Handle attributes (before directives, but skip directive attributes)
		this._handleAttributes(node, path);

		// Handle directives (if/await/each create sub-components and stop recursion)
		const isDirective = this._handleDirectives(node, path);

		if (isDirective) {
			// Directives handle their own children, don't recurse
			return;
		}

		// Handle web components
		if (isWebComponent(node)) {
			this.bindings.push({
				path,
				apply: (node) => {
					node.setAttribute('render', true);
				}
			});
		}

		// Recurse children (only if not a directive node)
		for (let i = 0; i < node.childNodes.length; i++) {
			this._walk(node.childNodes[i], [...path, i]);
		}
	}

	_handleDirectives(node, path) {
		// if/await/each directives create sub-components
		if (node.hasAttribute('if')) {
			this._handleIf(node, path);
			return true;
		}
		if (node.hasAttribute('await')) {
			this._handleAwait(node, path);
			return true;
		}
		for (const attr of node.attributes) {
			if (attr.name.startsWith('each:')) {
				this._handleEach(node, path, attr.name);
				return true;
			}
		}
		return false;
	}

	_handleAttributes(node, path) {
		for (const { name, value } of Array.from(node.attributes)) {
			// Skip directive attributes (if, await, each:*)
			if (name === 'if' || name === 'await' || name.startsWith('each:')) continue;

			if (!value.includes('{{--')) continue;

			// Check partial replacement first (more specific pattern with quotes)
			if (PARTIAL_PLACEHOLDER.test(value)) {
				const { parts, indices } = this._split(value);
				this.bindings.push({
					path,
					apply: (node, bctx) => Handlers.attrInterpolate(node, name, indices, parts, bctx)
				});
				continue;
			}

			// Full replacement (no quotes)
			const match = value.match(FULL_PLACEHOLDER);
			if (!match) continue;

			const idx = parseInt(match[1], 10);
			node.removeAttribute(name);

			if (name.startsWith('on')) {
				this.bindings.push({
					path,
					apply: (node, bctx) => {
						const handler = bctx.values[idx];
						if (typeof handler === 'function') {
							Handlers.event(node, name.substring(2).toLowerCase(), handler, bctx);
						} else {
							console.error('Event attributes must be functions');
						}
					}
				});
			} else if (name === ':this') {
				this.bindings.push({
					path,
					apply: (node, bctx) => {
						const sig = bctx.values[idx];
						if (isSignal(sig)) Handlers.ref(node, sig);
						else console.error(':this requires a signal');
					}
				});
			} else if (name === 'apply') {
				this.bindings.push({
					path,
					apply: (node, bctx) => {
						const fn = bctx.values[idx];
						if (typeof fn === 'function') Handlers.apply(node, fn, bctx);
						else console.error('apply requires a function');
					}
				});
			} else if (name.startsWith(':')) {
				const attrName = name.substring(1);
				this.bindings.push({
					path,
					apply: (node, bctx) => Handlers.twoWay(node, attrName, bctx.values[idx], bctx)
				});
			} else if (BOOLEAN_ATTRS.has(name.toLowerCase())) {
				this.bindings.push({
					path,
					apply: (node, bctx) => {
						const val = bctx.values[idx];
						if (isSignal(val) || typeof val === 'function') {
							Handlers.boolean(node, name, val, bctx);
						} else {
							console.error('Boolean attributes must be signals or functions');
						}
					}
				});
			} else {
				this.bindings.push({
					path,
					apply: (node, bctx) => Handlers.attrBind(node, name, bctx.values[idx], bctx)
				});
			}
		}
	}

	_handleIf(node, path) {
		const condIdx = this._parseIndex(node.getAttribute('if'));
		node.removeAttribute('if');

		const branches = this._collectBranches(Array.from(node.childNodes), condIdx);

		this.bindings.push({
			path,
			apply: (node, bctx) => {
				const conditions = branches.map(b => ({
					...b,
					sig: bctx.toSignal(b.condIdx !== null ? bctx.values[b.condIdx] : signal(true))
				}));

				let current = null;
				bctx.effect.UI(() => {
					if (current) current.remove();
					node.innerHTML = '';

					for (const { sig, comp } of conditions) {
						if (sig.v) {
							current = document.createElement(comp(bctx.values));
							const ctx = bctx.parent ? { ...bctx.ctx, __parentScopeClass: bctx.parent } : bctx.ctx;
							current.setContext(ctx, bctx.values);
							node.appendChild(current);
							break;
						}
					}
				});
			}
		});
	}

	_handleAwait(node, path) {
		const resIdx = this._parseIndex(node.getAttribute('await'));
		node.removeAttribute('await');

		const branches = this._collectResourceBranches(Array.from(node.childNodes), resIdx);

		this.bindings.push({
			path,
			apply: (node, bctx) => {
				const resource = bctx.toSignal(bctx.values[resIdx]);
				const states = branches.map(b => ({ ...b, sig: resource[b.state] }));

				let current = null;
				bctx.effect.UI(() => {
					if (current) current.remove();
					node.innerHTML = '';

					for (const { sig, comp } of states) {
						if (sig.v) {
							current = document.createElement(comp(bctx.values));
							const ctx = bctx.parent ? { ...bctx.ctx, __parentScopeClass: bctx.parent } : bctx.ctx;
							current.setContext(ctx, bctx.values);
							node.appendChild(current);
							break;
						}
					}
				});
			}
		});
	}

	_handleEach(node, path, attrName) {
		const iterator = attrName.substring(5);
		const listIdx = this._parseIndex(node.getAttribute(attrName));
		node.removeAttribute(attrName);

		const templateKeyBase = `${path.join('.')}:${iterator}:${listIdx}`;

		this.bindings.push({
			path,
			apply: (node, bctx) => {
				const list = bctx.toSignal(bctx.values[listIdx]);
				const length = computed(() => list.v.length);
				const templateKey = `${bctx.parent || 'root'}|${templateKeyBase}`;

				// Create component once
				if (!listCache.has(templateKey)) {
					const tmpl = document.createElement('template').content;
					for (const child of node.childNodes) {
						tmpl.appendChild(child.cloneNode(true));
					}
					const parsed = new TemplateParser(tmpl, this.values).parse();
					const compName = token(() => {
						// Factory is empty - rendering happens automatically via bypass options
					}, {
						template: tmpl,
						...parsed,
						parentScopeClass: bctx.ctx.__parentScopeClass || bctx.parent
					});
					listCache.set(templateKey, compName);
				}

				const compName = listCache.get(templateKey);
				let elements = [];

				bctx.effect.UI(() => {
					// Clean up old elements properly
					const oldElements = elements;
					elements = [];

					// Remove from DOM and trigger disconnectedCallback
					oldElements.forEach(el => {
						el.remove();
					});

					// Clear array to release references
					oldElements.length = 0;

					// Clear container
					node.innerHTML = '';

					// Flag to prevent stale promise callbacks from holding references
					let currentRenderValid = true;

					// Create new elements
					for (let i = 0; i < length.v; i++) {
						const el = document.createElement(compName);
						elements.push(el);

						const itemCtx = {
							[iterator]: list[i],
							[iterator + 'Index']: i,
							...bctx.ctx
						};
						if (bctx.parent) itemCtx.__parentScopeClass = bctx.parent;

						// Check if already defined to avoid promise callback leak
						const tagName = compName.toLowerCase();
						if (customElements.get(tagName)) {
							// Already defined, set context immediately (avoids promise)
							queueMicrotask(() => {
								if (currentRenderValid) {
									el.setContext(itemCtx, bctx.values);
								}
							});
						} else {
							// Not defined yet, use promise (first render only)
							customElements.whenDefined(tagName).then(() => {
								if (currentRenderValid) {
									queueMicrotask(() => {
										if (currentRenderValid) {
											el.setContext(itemCtx, bctx.values);
										}
									});
								}
							});
						}
						node.appendChild(el);
					}

					// Cleanup: invalidate this render when effect re-runs or unmounts
					return () => {
						currentRenderValid = false;
					};
				});
			}
		});
	}

	_collectBranches(nodes, initialIdx) {
		const branches = [];
		let currentNodes = [];
		let condIdx = initialIdx;

		for (const node of nodes) {
			if (node?.tagName === 'TEMPLATE' && (node.hasAttribute('else') || node.hasAttribute('elseif'))) {
				branches.push({
					condIdx,
					comp: this._createComponent(currentNodes)
				});
				currentNodes = [];
				condIdx = node.hasAttribute('elseif') ? this._parseIndex(node.getAttribute('elseif')) : null;
			} else {
				currentNodes.push(node);
			}
		}

		if (currentNodes.length > 0) {
			branches.push({ condIdx, comp: this._createComponent(currentNodes) });
		}

		return branches;
	}

	_collectResourceBranches(nodes, resIdx) {
		const states = { data: [], loading: [], error: [] };
		let current = 'data';

		for (const node of nodes) {
			if (node?.tagName === 'TEMPLATE' && (node.hasAttribute('loading') || node.hasAttribute('error'))) {
				current = node.hasAttribute('loading') ? 'loading' : 'error';
			} else {
				states[current].push(node);
			}
		}

		return ['loading', 'error', 'data']
			.filter(s => states[s].length > 0)
			.map(s => ({
				state: s,
				comp: this._createComponent(states[s])
			}));
	}

	_createComponent(nodes) {
		const tmpl = document.createElement('template');
		for (const node of nodes) {
			tmpl.content.appendChild(node.cloneNode(true));
		}
		const parsed = new TemplateParser(tmpl.content, this.values).parse();
		return (values) => token(() => {
			// Factory is empty - rendering happens automatically via bypass options
		}, {
			template: tmpl.content,
			...parsed,
			parentScopeClass: this.values.__parentScopeClass
		});
	}

	_split(str) {
		const parts = [];
		const indices = [];
		let last = 0;

		// Create global version for matchAll
		const globalPattern = new RegExp(PARTIAL_PLACEHOLDER.source, 'g');
		for (const match of str.matchAll(globalPattern)) {
			parts.push(str.slice(last, match.index));
			indices.push(parseInt(match[1], 10));
			last = match.index + match[0].length;
		}
		parts.push(str.slice(last));

		return { parts, indices };
	}

	_parseIndex(value) {
		const match = value?.match(FULL_PLACEHOLDER);
		return match ? parseInt(match[1], 10) : undefined;
	}
}

// ============================================================================
// BINDING EXECUTOR - Direct application
// ============================================================================

const getNode = (path, root) => {
	let node = root;
	for (const i of path) node = node.childNodes[i];
	return node;
};

const applyBindings = (bindings, values, root, ctx, parent, trackedEffect, scopeClassName = null) => {
	const bctx = new BindingContext(values, ctx, trackedEffect, parent, scopeClassName);
	let cancelled = false;
	// Ensure pending whenDefined continuations don't retain nodes/bctx after unmount
	if (trackedEffect) {
		bctx.effect(() => () => { cancelled = true; });
	}

	for (const { path, apply } of bindings) {
		const node = getNode(path, root);

		if (isWebComponent(node)) {
			// Check if already defined
			const tagName = node.tagName.toLowerCase();
			if (customElements.get(tagName)) {
				// Already defined, apply immediately in next microtask
				queueMicrotask(() => {
					if (!cancelled) apply(node, bctx);
				});
			} else {
				customElements.whenDefined(tagName).then(() => {
					queueMicrotask(() => {
						if (!cancelled) apply(node, bctx);
					});
				}).catch(err => {
					console.error('Error waiting for web component:', node.tagName, err);
				});
			}
		} else {
			apply(node, bctx);
		}
	}

	return trackedEffect ? [] : [];
};

// ============================================================================
// TEMPLATE CREATION
// ============================================================================

const createTemplateFromLiteral = (strings, ...values) => {
	let str = strings.reduce((acc, s, i) => {
		if (i >= values.length) return acc + s;

		if (typeof values[i] === 'string' || typeof values[i] === 'number') {
			if (!s.endsWith('<') && !s.endsWith('</')) {
				console.warn(`Value "${values[i]}" is not reactive`);
			}
			return acc + s + sanitizeHTML(values[i]);
		}

		return acc + s + `'{{--${i}--}}'`;
	}, '').replace(/[^\S\r\n]+/g, ' ');

	// Transform void elements
	str = str.replace(/<(br|hr|img|input|embed|source|track|wbr)(\s+[^>]*?)?\s*\/>/gi, '<$1$2>');

	// Transform directive tags
	str = str.replace(
		/<:(else|error|loading)(?:\s+if\s*=\s*('\{\{--\d+--\}\}'?))?\s*\/?>/g,
		(m, dir, cond) => dir === 'else' && cond
			? `<template elseif=${cond}></template>`
			: `<template ${dir}></template>`
	);

	// Transform self-closing tags
	str = str.replace(/<([a-zA-Z][a-zA-Z0-9-]*)\s*([^>]*?)\s*\/>/g, '<$1 $2></$1>');

	if (str.trim().toLowerCase().startsWith('<style')) {
		throw new Error('Template cannot start with <style> element');
	}

	const tmpl = document.createElement('template');
	tmpl.innerHTML = str;
	return tmpl.content;
};

const url = (strings, ...values) => {
	const sigs = values.map(v => isSignal(v) ? v : signal(v));
	return computed(() => {
		let u = strings[0];
		for (let i = 0; i < values.length; i++) {
			u += encodeURIComponent(sigs[i].v) + (strings[i + 1] || '');
		}
		return u;
	});
};

// ============================================================================
// CACHES
// ============================================================================

const templateCache = new Map();
const listCache = new Map();
const registeredComponents = new Set();

// ============================================================================
// COMPONENT DEFINITION
// ============================================================================

const component = (name, factory, bypass = {}) => {
	if (registeredComponents.has(name)) {
		console.warn(`Component ${name} already exists`);
		return name;
	}

	registeredComponents.add(name);
	let sharedData = null;
	let templateHash = null;

	// If bypass options with template are provided, initialize sharedData immediately
	if (bypass?.template) {
		sharedData = {
			template: bypass.template,
			bindings: bypass.bindings || [],
			slots: bypass.slots || [],
			styleElement: null,
			globalStyleElement: null,
			scopeClassName: bypass.parentScopeClass || null,
			instanceCount: 0,
			componentNames: new Set([name])
		};
	}

	customElements.define(name, class extends HTMLElement {
		#props = {};
		#mountHooks = [];
		#unmountHooks = [];
		#additionalContext = null;
		#bypassValues = null;
		#prepared = false;
		#renderCalled = false;
		#trackedEffect = null;

		constructor() {
			if (factory.constructor.name === 'AsyncFunction') {
				throw new Error('Factory cannot be async');
			}
			super();

			// Create tracked effect once for reuse throughout component
			this.#trackedEffect = new Proxy(this.#createTracked(effect), {
				get: (_, prop) => {
					const fn = effect[prop];
					return typeof fn === 'function' ? this.#createTracked(fn) : fn;
				}
			});
		}

		#prepareContent() {
			if (this.#prepared) return;
			this.#prepared = true;
			Array.from(this.attributes).forEach(({ name, value }) => {
				if (name === 'render' && value === '') return;
				if (!this.#props.hasOwnProperty(name)) {
					this.setAttribute(name, value === '' ? true : value);
				}
			});

			const context = {
				lifeCycle: {
					onMount: (fn) => this.#mountHooks.push(fn),
					onUnmount: (fn) => this.#unmountHooks.push(fn)
				},
				html: (strings, ...values) => this.#render(strings, values),
				url,
				signal,
				computed,
				effect: this.#trackedEffect
			};

			const props = new Proxy(this.#props, {
				get(target, prop) {
					prop = String(prop).toLowerCase();
					if (!(prop in target)) {
						console.warn(`Property ${prop} not set`);
						return undefined;
					}
					return Reflect.get(target, prop);
				}
			});

			wrapInContext(() => factory(props, context), context)();

			// If sharedData exists (from bypass options) but #render wasn't called,
			// render automatically with bypass-provided values (per-instance if setContext provided them)
			if (sharedData && !this.#renderCalled) {
				this.#render([], this.#bypassValues ?? bypass?.values ?? []);
			}
		}

		#createTracked = (fn) => (...args) => {
			const cleanup = fn(...args);
			if (cleanup && typeof cleanup === 'function') {
				this.#unmountHooks.push(cleanup);
			}
			return cleanup;
		};

		#render(strings, values) {
			if (this.#renderCalled) {
				console.error('html() can only be called once inside a component');
				return;
			}
			this.#renderCalled = true;

			if (!sharedData) this.#prepareTemplate(strings, values);
			this.#instantiate(values);
		}

		#prepareTemplate(strings, values) {
			const template = createTemplateFromLiteral(strings, ...values);
			const tempTmpl = document.createElement('template');
			tempTmpl.content.appendChild(template.cloneNode(true));
			templateHash = hash(tempTmpl.innerHTML);

			if (templateCache.has(templateHash)) {
				sharedData = templateCache.get(templateHash);
				sharedData.componentNames.add(name);
				sharedData.instanceCount++;
				return;
			}

			const parser = new TemplateParser(template, values);
			const { bindings, slots, styleElements } = parser.parse();

			const useParentScope = bypass?.parentScopeClass;
			let styleEl = null;
			let globalStyleEl = null;
			let scopeClass = null;

			if (styleElements.length > 0 && !useParentScope) {
				const scoped = styleElements
					.filter(s => !s.hasAttribute('global'))
					.map(s => s.textContent)
					.join('\n');

				const { combinedStylesScoped, scopeClass: sc } = scopeCSS(scoped, `hash-${templateHash}`);
				scopeClass = sc;

				styleEl = document.createElement('style');
				styleEl.setAttribute('data-component', name);
				styleEl.setAttribute('data-hash', templateHash);
				styleEl.textContent = combinedStylesScoped;

				const global = styleElements
					.filter(s => s.hasAttribute('global'))
					.map(s => s.textContent)
					.join('\n');

				globalStyleEl = document.createElement('style');
				globalStyleEl.setAttribute('data-component', name);
				globalStyleEl.setAttribute('data-hash', templateHash);
				globalStyleEl.setAttribute('global', '');
				globalStyleEl.textContent = global;

				styleElements.forEach(s => s.remove());
			} else if (useParentScope) {
				scopeClass = useParentScope;
				styleElements.forEach(s => s.remove());
			}

			if (scopeClass) {
				const walk = (node) => {
					Array.from(node.childNodes).forEach(n => {
						if (n.nodeType === Node.ELEMENT_NODE) {
							n.classList.add(scopeClass);
							walk(n);
						}
					});
				};
				walk(template);
			}

			sharedData = {
				template: bypass?.template || template,
				bindings: bypass?.bindings || bindings,
				slots: bypass?.slots || slots,
				styleElement: styleEl,
				globalStyleElement: globalStyleEl,
				scopeClassName: scopeClass,
				instanceCount: 1,
				componentNames: new Set([name])
			};

			templateCache.set(templateHash, sharedData);
		}

		#instantiate(values) {
			const copy = sharedData.template.cloneNode(true);
			const ctx = {
				...this.#additionalContext,
				__parentScopeClass: this.#additionalContext?.__parentScopeClass || name
			};

			applyBindings(sharedData.bindings, values, copy, ctx, name, this.#trackedEffect, sharedData.scopeClassName);

			const slotEls = Object.fromEntries(
				sharedData.slots.map(([n, idx]) => [n, getNode(idx, copy)])
			);

			const plugs = {};
			for (const child of this.children) {
				const slotName = child.getAttribute('slot') || 'default';
				if (!slotEls[slotName]) {
					console.warn(`No slot "${slotName}" found`);
					child.remove();
				} else {
					if (!plugs[slotName]) plugs[slotName] = [];
					plugs[slotName].push(child);
				}
			}

			for (const [slotName, children] of Object.entries(plugs)) {
				const slot = slotEls[slotName];
				if (slot) {
					slot.textContent = '';
					slot.style.display = 'contents';
					for (const child of children) {
						slot.appendChild(child);
					}
				}
			}

			if (sharedData.styleElement && !sharedData.styleElement.parentNode) {
				document.head.appendChild(sharedData.styleElement);
			}
			if (sharedData.globalStyleElement && !sharedData.globalStyleElement.parentNode) {
				document.head.appendChild(sharedData.globalStyleElement);
			}

			this.appendChild(copy);
			this.#mountHooks.forEach(h => h());
		}

		setContext(context, values) {
			this.#additionalContext = context;
			if (values !== undefined) this.#bypassValues = values;
			this.#prepareContent();
		}

		setAttribute(name, value, bind = false) {
			if (name === 'render' && value === true) {
				this.#prepareContent();
				return;
			}

			if (bind) {
				this.#props[name] = value;
				const domValue = typeof value === 'function' ? 'functionAttribute'
					: (isSignal(value) ? value.v : value);
				super.setAttribute(name, domValue);
				if (isSignal(value)) {
					this.#trackedEffect(() => super.setAttribute(name, value.v));
				}
				return;
			}

			const type = isSignal(value) ? 'signal' : typeof value;
			if (type === 'function' || type === 'signal') {
				if (!this.#props[name]) {
					this.#props[name] = computed(() => {
						if (isSignal(value)) return value.v;
						if (typeof value === 'function') return value();
						return value;
					});
					this.#trackedEffect(() => super.setAttribute(name, this.#props[name].v));
				}
			} else {
				if (!this.#props[name]) {
					this.#props[name] = computed(() => value);
					this.#trackedEffect(() => super.setAttribute(name, this.#props[name].v));
				}
			}
		}

		getAttribute(name, raw = false) {
			return raw
				? (this.#props[name] ?? super.getAttribute(name))
				: (this.#props[name]?.v ?? super.getAttribute(name));
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
				if (sharedData.instanceCount === 0) {
					queueMicrotask(() => {
						if (sharedData.instanceCount === 0) {
							sharedData.styleElement?.remove();
							sharedData.globalStyleElement?.remove();
						}
					});
				}
			}
			this.#unmountHooks.forEach(h => h());
		}
	});

	return name;
};

const token = (factoryOrString, bypassOrFactory, bypass) => {
	if (typeof factoryOrString === 'string' && typeof bypassOrFactory === 'function') {
		return component(factoryOrString, bypassOrFactory, bypass);
	}

	if (typeof factoryOrString === 'function' && (!bypassOrFactory || typeof bypassOrFactory === 'object')) {
		if (bypassOrFactory?.template) {
			const tmpl = document.createElement('template');
			tmpl.content.appendChild(bypassOrFactory.template.cloneNode(true));
			const templateHash = hash(tmpl.innerHTML);
			const name = `tok-${templateHash}`;

			if (registeredComponents.has(name)) return name;
			return component(name, factoryOrString, bypassOrFactory);
		}

		let name;
		do name = `tok-${randomId()}-${randomId()}`;
		while (registeredComponents.has(name));
		return component(name, factoryOrString, bypassOrFactory);
	}

	console.error('Invalid arguments to token()', factoryOrString, bypassOrFactory, bypass);
};

export {
	token as default,
	token,
	signal,
	computed,
	effect as dirtyEffect,
	url
};
