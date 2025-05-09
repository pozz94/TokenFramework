import { signal, computed, effect } from './signal.js';
import { component } from './component.js';

export default component("my-counter", (props) => {
	let { prop1 = "100px", prop2 = "Hello World", html } = props;

	const count = signal(0);
	const derived = computed(() => count.v * 2);
	const color = signal('black');
	const input = signal('Hello World');

	const decrement = () => {
		count.v--;
	};

	const changeColor = () => {
		color.v = color.v === 'black' ? 'red' : 'black';
	};

	effect(() => {
		console.log('input:', input.v);
	});

	// Add this before returning the html template:
	return html`
		<style scoped>
			button { margin: 0.5rem; }
		</style>

		<div style="color: ${color}">current count: ${count}</div>
		<div style="color: ${color}">doubled count: ${derived}</div>

		<button onclick=${() => count.v++}> + </button>
		<button onclick=${decrement}> - </button>
		<button onclick=${changeColor}>Change color</button>

		<p width=${prop1}>${prop2}</p>

		<input type="text" :value=${input}></input>
		<p>${input}</p>
		
		<slot name="slot2"></slot>
		<slot name="slot1"></slot>`;
});