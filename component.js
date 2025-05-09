import { UIeffect } from './signal.js';

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

const ifStringSanitize = (value) => typeof value === 'string' ? sanitize(value) : value;


const parseAttributes = (element, args) => {
    const attributes = Array.from(element.attributes);

    attributes.forEach(({ name, value }) => {
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
            const originalValue = `${value}`;
            const matches = [...originalValue.matchAll(partialReplacementPlaceholder)];
            if (matches.length) { // handle partial replacement
                UIeffect(() => {
                    let newValue = originalValue;
                    for (const match of matches) {
                        const index = parseInt(match[1], 10);
                        const arg = args[index];
                        const replacement = isSignal(arg) ? arg.v : arg;
                        newValue = originalValue.replace(`'{{--${index}--}}'`, ifStringSanitize(replacement));
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
            }
        }
    });
};

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
    return fragment;
};

const component = (name, factory) => {
    customElements.define(name, class extends HTMLElement {
        constructor() {
            super();
            this._props = {};
            this._mountHooks = [];
            this._updateHooks = [];
            this.attachShadow({ mode: 'open' });
        }

        connectedCallback() {
            const props = {
                ...this._props,
                mounthook: (fn) => this._mountHooks.push(fn),
                updatehook: (fn) => this._updateHooks.push(fn),
                html: (strings, ...args) => parseTemplate(strings, ...args)
            };

            const fragment = factory(props);

            // Handle styles
            fragment.querySelectorAll('style[scoped]').forEach(style => {
                this.shadowRoot.appendChild(style.cloneNode(true));
            });

            this.shadowRoot.appendChild(fragment);

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