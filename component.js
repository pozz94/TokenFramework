import { UIeffect, effect, signal } from './signal.js';

const isSignal = (obj) => typeof obj === 'object' && obj !== null && 'v' in obj;

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

            //console.log('node', node.tagName);

            if (node.tagName === 'SLOT') {
                console.log('slot', node.getAttribute('name')??'default', node);
                slots.push([node.getAttribute('name')??'default', node]);
            }

            for (const { name, value } of attributes) {
                if (name.startsWith('on')) { // handle event attributes
                    const match = value.match(fullReplacementPlaceholder);
                    if (match) {
                        const index = parseInt(match[1], 10);
                        bindingFunctions.push((bindingValues, node) => {
                            const handler = bindingValues[index];
                            if (typeof handler === 'function') {
                                const eventName = name.substring(2, name.indexOf('-function-index')).toLowerCase();
                                node.addEventListener(eventName, handler);
                            }
                            node.removeAttribute(name);
                        });
                    }
                } else if (name === ":this") {
                    const match = value.match(fullReplacementPlaceholder);
                    if (match) {
                        const index = parseInt(match[1], 10);
                        bindingFunctions.push((bindingValues, node) => {
                            const sig = bindingValues[index];
                            if (isSignal(sig)) {
                                sig.v = node;
                            } else {
                                console.error('to save a reference to the element, a signal must be passed as an bindingValueument');
                            }
                            node.removeAttribute(name);
                        });
                    }
                } else if (name === "slot") {
                    console.log('plug', value, node);
                    plugs.push([value, node]);
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

                        if (name.endsWith('-function-index')) {
                            // Handle function binding
                            if (typeof bindingValues[index] === 'function') {
                                bindingFunctions.push((bindingValues, node) => {
                                    const func = bindingValues[index];
                                    if (typeof node.setPassedDownFunctions === 'function') {
                                        node.setPassedDownFunctions(index, func);
                                    } else {
                                        // If the method isn't available yet, use a MutationObserver to wait for it
                                        const observer = new MutationObserver((mutations, obs) => {
                                            if (typeof node.setPassedDownFunctions === 'function') {
                                                node.setPassedDownFunctions(index, func);
                                                obs.disconnect();
                                            }
                                        });
                                        observer.observe(node, {
                                            attributes: true,
                                            childList: false,
                                            subtree: false
                                        });

                                        // Add a timeout to prevent infinite observation
                                        setTimeout(() => {
                                            if (observer) {
                                                observer.disconnect();
                                            }
                                        }, 5000);


                                    }
                                });
                            }
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

const applyBindings = (bindings, bindingValues, origin) => {
    if (bindings.length) {
        for (const { index, bindingFunctions } of bindings) {
            const element = getNodeAtIndex(index, origin);
            for (const func of bindingFunctions) {
                func(bindingValues, element);
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

const isWebComponent = (element) => element instanceof HTMLElement && element.tagName.includes('-');

const createTwoWayBinding = (element, boundAttrName, sig) => {
    // Handle signal changes
    if (!isWebComponent(element)) {
        // Handle attribute changes
        element.addEventListener('input', (e) => {
            sig.v = element[boundAttrName];
        });
        UIeffect(() => {
            element.setAttribute(boundAttrName, sig.v);
        });
    }
    else {
        UIeffect(() => {
            sig.v;
            element.setAttribute(boundAttrName, sig, true);
        });
    }
};

const createTemplateFromLiteral = (strings, ...bindingValues) => {
    const templateString = strings.reduce((acc, str, i) => {
        //        // If we're at the last string piece and no more values, just append it
        if (i >= bindingValues.length) {
            return acc + str;
        }

        // Check if this string ends with an equals sign (attribute binding)
        if (str.endsWith('=') && typeof bindingValues[i] === 'function') {
            str = str.substring(0, str.length - 1) + `-function-index=`;
        }

        // Regular value binding
        return acc + str + `'{{--${i}--}}'`;
    }, '');

    const template = document.createElement('template');
    template.innerHTML = templateString;

    return template.content;
};

const registeredComponentList = new Set();

const component = (name, factory) => {
    if (registeredComponentList.has(name)) {
        console.warn(`Component with name ${name} already exists`);
        return;
    } else {
        registeredComponentList.add(name);
    }

    let template = null;
    let bindings = [];
    let slots = [];
    let plugs = [];

    customElements.define(name, class extends HTMLElement {
        _props = {};
        _mountHooks = [];
        _iterators = {}; //iterator object, contains all iterators to be used in list rendering
        _passedDownFunctions = {};

        constructor() {
            super();
            //const shadow = this.attachShadow({ mode: 'open' });
            // Get external stylesheet
            const externalSheets = document.adoptedStyleSheets;
            console.log('externalSheets', externalSheets);
            // Apply it to shadow DOM
            //shadow.adoptedStyleSheets = [externalSheet];
            this.style.display = 'contents';

            this.#initializeProps();
        }

        #initializeProps = () => {
            Array.from(this.attributes).forEach(({ name, value }) => {
                if (name.endsWith('-function-index')) {
                    const fullReplacementPlaceholder = /\{\{--(\d+)--\}\}/;
                    const match = value.match(fullReplacementPlaceholder);

                    const index = match[1];
                    console.log('index', index);
                    const newName = name.substring(0, name.indexOf('-function-index'));
                    const fn = (...args) => this._passedDownFunctions[index](...args);
                    //const fn = (...args) =>this._props[name](...args);

                    this._props[newName] = fn;
                    return;
                }
                if (typeof this._props[name] === 'function' || isSignal(this._props[name])) {
                    // If it's already a function in _props, leave it as is
                    return;
                }
                // Otherwise, create a signal
                this._props[name] = signal(value);
            });
        };

        setPassedDownFunctions(key, value) {
            console.log('setPassedDownFunctions', key, value);
            this._passedDownFunctions[key] = value;
        }

        generateCopy = (bindingValues) => {
            const copy = template.cloneNode(true);

            applyBindings(bindings, bindingValues, copy);

            for (const [slotName, slot] of slots) {
                const slotContent = this.querySelector(`[slot="${slotName}"]`);
                console.log('slotContent', slotContent, slotName);
                if (slotContent) {
                    slot.replaceWith(slotContent);
                }
            }

            //this.shadowRoot.appendChild(copy);
            this.appendChild(copy);
        };

        setAttribute(name, value, bind = false) {
            const signal = isSignal(value);

            if (!isSignal(this._props[name]) && !typeof this._props[name] === 'function') {
                this._props[name] = signal ? value : signal(value);
            }

            if (typeof value === 'function') {
                console.log('function', name, value);
                this._props[name] = value;
            } else if (signal) {
                super.setAttribute(name, value.v);
                if (!bind) {
                    this._props[name].v = value.v;
                } else {
                    this._props[name].v = value.v;
                    if (!this._props[name].bind) {
                        this._props[name].bind = value;
                        effect(() => {
                            value.v = this._props[name].v;
                        });
                    }
                }
            } else {
                super.setAttribute(name, value);
                this._props[name].v = value;
            }
        }

        connectedCallback() {
            const templateRenderer = (strings, ...bindingValues) => {
                const id = Math.random().toString(36).substring(7);

                if (!template) {
                    console.time(`${name} createTemplateFromLiteral ${id}`);

                    template = createTemplateFromLiteral(strings, ...bindingValues);
                    const { bindings: foundBindings, slots: foundSlots, plugs: foundPlugs } = findTemplateBindings(template, bindingValues);

                    bindings = foundBindings;
                    slots = foundSlots;
                    plugs = foundPlugs;

                    console.log(slots, plugs);

                    console.timeEnd(`${name} createTemplateFromLiteral ${id}`);
                }

                console.time(`${name} generateCopy ${id}`);
                this.generateCopy(bindingValues);
                console.timeEnd(`${name} generateCopy ${id}`);
            };

            const props = {
                ...this._props,
                mounthook: (fn) => this._mountHooks.push(fn),
                html: templateRenderer,
                i: this._iterators,
            };

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

            this._mountHooks.forEach(hook => hook());
        }
    });
};

export { component };