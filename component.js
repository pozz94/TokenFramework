import { UIeffect, effect, signal } from './signal.js';

const fullReplacementPlaceholder = /\{\{--(\d+)--\}\}/;
const partialReplacementPlaceholder = /\'\{\{--(\d+)--\}\}\'/g;

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
    if (node.nodeType === Node.TEXT_NODE) { // handle text nodes
        const originalValue = `${node.nodeValue}`;
        const matches = [...originalValue.matchAll(partialReplacementPlaceholder)];
        if (matches.length) {
            UIeffect(() => {
                //console.log('effect on text node:', originalValue);
                //console.log('originalValue:', originalValue);
                let newValue = originalValue;
                for (const match of matches) {
                    const index = parseInt(match[1], 10);
                    const arg = args[index];
                    const replacement = isSignal(arg) ? arg.v : arg;
                    //console.log('replacement:', arg);
                    newValue = originalValue.replace(`'{{--${index}--}}'`, ifStringSanitize(replacement));
                }
                node.nodeValue = newValue;
            });
        }
    } else {
        node.childNodes.forEach(child => parseTextNodes(child, args));
    }
};

const parseAttributes = (element, args) => {
    const attributes = Array.from(element.attributes);

    attributes.forEach(({ name, value }) => {
        const fullReplacementPlaceholder = /\{\{--(\d+)--\}\}/;
        const partialReplacementPlaceholder = /\'\{\{--(\d+)--\}\}\'/g;

        if (name.startsWith('on')) { // handle event attributes
            const match = value.match(fullReplacementPlaceholder);
            if (match) {
                const index = parseInt(match[1], 10);
                const handler = args[index];
                if (typeof handler === 'function') {
                    const eventName = name.substring(2).toLowerCase();
                    element.addEventListener(eventName, handler);
                }
                element.removeAttribute(name);
            }
        } else if (name === ":this") {
            const match = value.match(fullReplacementPlaceholder);
            if (match) {
                const index = parseInt(match[1], 10);
                const sig = args[index];
                if (isSignal(sig)) {
                    sig.v = element;
                } else {
                    console.error('to save a reference to the element, a signal must be passed as an argument');
                }
                element.removeAttribute(name);
            }
        } else if (name.startsWith(':')) { // handle bound attributes
            const match = value.match(fullReplacementPlaceholder);
            if (match) {
                const index = parseInt(match[1], 10);
                const sig = args[index];
                if (isSignal(sig)) {
                    createTwoWayBinding(element, name.substring(1), sig);
                } else {
                    console.error('bound attribute must be a signal');
                }
                element.removeAttribute(name);
            }
        } else {
            if (partialReplacementPlaceholder.test(value)) { // handle partial replacement
                const { parts, indices } = splitTemplate(value, args);
                const expressions = indices.map(index => args[index]);
                console.log('expressions:', expressions);
                UIeffect(() => {
                    let newValue = '';
                    let index = 0;
                    for (const part of parts) {
                        newValue += part + ifStringSanitize(expressions[index]?.v) ?? '';
                        index++;
                    }
                    element.setAttribute(name, newValue);
                });
            } else if (fullReplacementPlaceholder.test(value)) { // handle full replacement
                const match = value.match(fullReplacementPlaceholder);
                const index = parseInt(match[1], 10);
                const arg = args[index];
                UIeffect(() => {
                    const replacement = isSignal(arg) ? arg.v : arg;
                    element.setAttribute(name, ifStringSanitize(replacement));
                });
            } else {
                element.setAttribute(name, value);
            }
        }
    });
};

//function splitTemplate(str, args) {
//    const partialReplacementPlaceholder = /\'\{\{--(\d+)--\}\}\'/g;
//    const parts = [];
//    const indices = [];
//    let lastIndex = 0;
//    const matches = [...str.matchAll(partialReplacementPlaceholder)];
//
//    for (const match of matches) {
//        parts.push(str.slice(lastIndex, match.index));
//        indices.push(parseInt(match[1], 10));
//        lastIndex = match.index + match[0].length;
//    }
//    parts.push(str.slice(lastIndex));
//
//    return { parts, indices };
//}

function splitTemplate(str, args, element) {
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
                '\nOne or more of the arguments here are not signals, if you expect all of them to change reactively, make sure they are signals',
                '\nRemember: those that are not signals will never update. Here are the non-signal values:\n',
                notSignals
            );
        }

        lastIndex = match.index + match[0].length;
    }
    parts.push(temp + str.slice(lastIndex));

    console.log('parts:', parts);
    console.log('indices:', indices);

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
        parseAttributes(node, args);
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
    //console.log('parseTemplate:', args);
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
            console.log('observedAttributes:', this.attributes);
            // Store initial attributes
            Array.from(this.attributes).forEach(attr => {
                this.constructor[Symbol.for('observedAttributes')].add(attr.name);
            });
        }

        attributeChangedCallback(name, oldValue, newValue) {
            console.log('attributeChangedCallback:', name, oldValue, newValue);
            const observedAttrs = this.constructor[Symbol.for('observedAttributes')];
            if (observedAttrs.has(name) && this._props[name]) {
                this._props[name].v = newValue;
                this._updateHooks.forEach(hook => hook());
            }
        }

        connectedCallback() {
            //console.log(this.attributes)
            Array.from(this.attributes).forEach(attr => {
                this._props[attr.name] = signal(attr.value);
                //console.log('signal:', this._props[attr.name]);
                effect(() => {
                    console.log('effect on custom element attribute:', attr.name);
                    this.setAttribute(attr.name, this._props[attr.name].v)
                });
            });
            //UIeffect(() => console.log(Object.fromEntries(Object.entries(this._props).map(([k, v]) => [k, v.v]))))

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