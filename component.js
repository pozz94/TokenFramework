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

const parseTextNodes = (node, args) => {
    const partialReplacementPlaceholder = /\'\{\{--(\d+)--\}\}\'/g;
    if (node.nodeType === Node.TEXT_NODE && partialReplacementPlaceholder.test(node.nodeValue)) { // handle text nodes
        const { parts, indices } = splitTemplate(node.nodeValue, args);
        const expressions = [];
        for (const index of indices) {
            expressions.push(args[index]);
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
    } else {
        node.childNodes.forEach(child => parseTextNodes(child, args));
    }
};

const parseAttributes = (element, args) => {
    const attributes = Array.from(element.attributes);

    const argsToAttach = [];
    const attachArgs = (args) => { for (const func of argsToAttach) { func(args); } };

    for (const { name, value } of attributes) {
        const fullReplacementPlaceholder = /\{\{--(\d+)--\}\}/;
        const partialReplacementPlaceholder = /\'\{\{--(\d+)--\}\}\'/g;

        if (name.startsWith('on')) { // handle event attributes
            const match = value.match(fullReplacementPlaceholder);
            if (match) {
                const index = parseInt(match[1], 10);
                argsToAttach.push(args => {
                    const handler = args[index];
                    if (typeof handler === 'function') {
                        const eventName = name.substring(2).toLowerCase();
                        element.addEventListener(eventName, handler);
                    }
                    element.removeAttribute(name);
                });
            }
        } else if (name === ":this") {
            const match = value.match(fullReplacementPlaceholder);
            if (match) {
                const index = parseInt(match[1], 10);
                argsToAttach.push(args => {
                    const sig = args[index];
                    if (isSignal(sig)) {
                        sig.v = element;
                    } else {
                        console.error('to save a reference to the element, a signal must be passed as an argument');
                    }
                    element.removeAttribute(name);
                });
            }
        } else if (name.startsWith(':')) { // handle bound attributes
            const match = value.match(fullReplacementPlaceholder);
            if (match) {
                const index = parseInt(match[1], 10);
                argsToAttach.push(args => {
                    if (isSignal(args[index])) {
                        createTwoWayBinding(element, name.substring(1), args[index]);
                    } else {
                        console.error('bound attribute must be a signal');
                    }
                    element.removeAttribute(name);
                });
            }
        } else {
            if (partialReplacementPlaceholder.test(value)) { // handle partial replacement
                const { parts, indices } = splitTemplate(value, args);
                argsToAttach.push(args => {
                    const expressions = [];
                    for (const index of indices) {
                        expressions.push(args[index]);
                    }
                    UIeffect(() => {
                        let newValue = '';
                        let index = 0;
                        for (const part of parts) {
                            newValue += part + ifStringSanitize(expressions[index]?.v) ?? '';
                            index++;
                        }
                        element.setAttribute(name, newValue);
                    });
                });
            } else if (fullReplacementPlaceholder.test(value)) { // handle full replacement
                const match = value.match(fullReplacementPlaceholder);
                const index = parseInt(match[1], 10);

                argsToAttach.push(args => {
                    const arg = args[index];
                    UIeffect(() => {
                        const replacement = isSignal(arg) ? arg.v : arg;
                        element.setAttribute(name, ifStringSanitize(replacement));
                    });
                });
            }
        }
    }
    return { element, attachArgs };
};

function splitTemplate(str, args) {
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
        const arg = args[index];

        if (!isSignal(arg)) {
            // If not a signal, combine the arg with the next part
            notSignals[match[0]] = arg;

            temp += currentPart + arg;
        } else {
            // If it is a signal, keep them separate
            parts.push(temp + currentPart);
            indices.push(index);
            temp = '';
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

    //console.log('parts:', parts);
    //console.log('indices:', indices);

    return { parts, indices };
}

const createTwoWayBinding = (element, boundAttrName, sig) => {
    // Handle attribute changes
    element.addEventListener('input', (e) => {
        sig.v = element[boundAttrName];
    });
    // Handle signal changes
    UIeffect(() => {
        element.setAttribute(boundAttrName, sig.v);
    });
    // Initial value
    element.setAttribute(boundAttrName, sig.v);
};

function parseElement(node, args) {
    // Handle element nodes
    if (node.nodeType === Node.ELEMENT_NODE) {
        const { attachArgs, element } = parseAttributes(node, args);
        attachArgs(args);
    }

    // Handle text nodes
    if (node.nodeType === Node.TEXT_NODE) {
        parseTextNodes(node, args);
    }

    // Process all child nodes
    node.childNodes.forEach(child => parseElement(child, args));
}

const parseTemplate = (strings, ...args) => {
    //perfomance test
    console.time('parseTemplate');
    ////console.log('parseTemplate:', args);
    const templateString = strings.reduce((acc, str, i) =>
        acc + str + (i < args.length ? `'{{--${i}--}}'` : ''), '');

    const template = document.createElement('template');
    template.innerHTML = templateString;
    const fragment = template.content.cloneNode(true);

    // Handle slot content
    const slots = fragment.querySelectorAll('slot');
    slots.forEach(slot => {
        const name = slot.getAttribute('name');
        if (name) slot.innerHTML = `<span style="display:contents" slot="${name}"></span>`;
    });

    parseElement(fragment, args);
    console.timeEnd('parseTemplate');
    return fragment;
};

const component = (name, factory) => {
    customElements.define(name, class extends HTMLElement {
        // Use a Symbol to store the actual observed attributes
        static [Symbol.for('observedAttributes')] = new Set();

        // Return array of all attribute names we want to observe
        static get observedAttributes() {
            return Array.from(this[Symbol.for('observedAttributes')]);
        }

        constructor() {
            super();
            this._props = {};
            this._mountHooks = [];
            this._updateHooks = [];
            this.attachShadow({ mode: 'open' });
            //console.log('observedAttributes:', this.attributes);
            // Store initial attributes
            Array.from(this.attributes).forEach(attr => {
                this.constructor[Symbol.for('observedAttributes')].add(attr.name);
            });
        }

        attributeChangedCallback(name, oldValue, newValue) {
            //console.log('attributeChangedCallback:', name, oldValue, newValue);
            const observedAttrs = this.constructor[Symbol.for('observedAttributes')];
            if (observedAttrs.has(name) && this._props[name]) {
                this._props[name].v = newValue;
                this._updateHooks.forEach(hook => hook());
            }
        }

        connectedCallback() {
            ////console.log(this.attributes)
            Array.from(this.attributes).forEach(attr => {
                this._props[attr.name] = signal(attr.value);
                ////console.log('signal:', this._props[attr.name]);
                effect(() => {
                    //console.log('effect on custom element attribute:', attr.name);
                    this.setAttribute(attr.name, this._props[attr.name].v)
                });
            });
            //UIeffect(() => //console.log(Object.fromEntries(Object.entries(this._props).map(([k, v]) => [k, v.v]))))

            const handler = (strings, ...args) => {
                const fragment = parseTemplate(strings, ...args);
                // Handle styles
                fragment.querySelectorAll('style[scoped]').forEach(style => {
                    this.shadowRoot.appendChild(style.cloneNode(true));
                });

                this.shadowRoot.appendChild(fragment);
            };

            const props = {
                ...this._props,
                mounthook: (fn) => this._mountHooks.push(fn),
                updatehook: (fn) => this._updateHooks.push(fn),
                html: handler,
            };

            factory(props);

            // Handle slots
            const slotContent = this.querySelectorAll('[slot]');
            slotContent.forEach(node => {
                const slotName = node.getAttribute('slot');
                const slotElement = this.shadowRoot.querySelector(`slot[name="${slotName}"]`);
                if (slotElement) {
                    slotElement.replaceWith(node.cloneNode(true));
                }
            });

            this._mountHooks.forEach(hook => hook());
            this._triggerUpdate();
        }

        _triggerUpdate() {
            this._updateHooks.forEach(hook => hook());
        }

        setProps(props) {
            Object.assign(this._props, props);
        }
    });
};

export { component };