import { effect } from './signal.js';

const attributePlaceholder = /\{\{--(\d+)--\}\}/g;
const partialPlaceholder = /\"\{\{--(\d+)--\}\}\"/g;

const parseAttributes = (element, args) => element.attributes.forEach(({ name, value }) => {
	if (!name.includes('on')) {
		// Fully replace placeholders within attribute values
		const match = value.match(partialPlaceholder);
		if (match) {
			const index = parseInt(match[0], 10);
			effect(() => {
				element.setAttribute(name, args[index]);
			});
		}

		// Replace placeholders within attribute values
		const originalValue = value;
        const matches = [...originalValue.matchAll(partialPlaceholder)];
        if (matches.length) {
            effect(() => {
                let newValue = originalValue;
                for (const match of matches) {
                    const index = parseInt(match[1], 10);
                    newValue = newValue.replace(`"{{--${index}--}}"`, args[index]);
                }
                element.setAttribute(name, newValue);
            });
        }
	} else {
		// Replace event listeners
		const match = value.match(attributePlaceholder);
        if (match) {
            const index = parseInt(match[1], 10);
            const eventName = name.slice(2).toLowerCase();
            element.addEventListener(eventName, args[index]);
        }
	}
});

const parseTextNodes = (node, args) => {
    node.childNodes.forEach(parseTextNodes);
    if (node.nodeType === 3) {
        const originalValue = node.nodeValue;
        const matches = [...originalValue.matchAll(attributePlaceholder)];
        if (matches.length) {
            effect(() => {
                let newValue = originalValue;
                for (const match of matches) {
                    const index = parseInt(match[1], 10);
                    newValue = newValue.replace(`{{--${index}--}}`, args[index]);
                }
                node.nodeValue = newValue;
            });
        }
    }
};

const parseElement = (element, args) => {
	if (!element || !element.nodeType) return;

	if (element.nodeType === Node.ELEMENT_NODE) {
		parseAttributes(element, args);
		parseTextNodes(element, args);

		element.children.forEach(child => parseElement(child, args));
	}
};

const parseTemplate = (strings, ...args) => {
	const templateString = strings.reduce((acc, str, i) => {
		return acc + str + `"{{--${i}--}}"`;
	}, '');

	const template = document.createElement('template');
	template.innerHTML = templateString;

	parseElement(template, args);
};


export const component = (name, template) => {
	const t = template();


};