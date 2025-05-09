import { signal, computed, effect } from './signal.js';
import { component } from './component.js';
import './my-test.js';

component("my-counter", async ({ width = signal("150px"), prop2 = signal("Hello World"), html }) => {
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

	const unit = 'px';

	html`
		<style>
			button { margin: 1rem; }

			my-counter {
				button { background-color: lightblue; }
			}
		</style>

		<div style="color: ${color}; width: ${width}; background-color: lightgray; font-size: 20${unit}">current count: ${count}</div>
		<div style="color: ${color}">doubled count: ${derived}</div>
		<div style="color: ${color}">current count: ${count}; doubled count: ${derived}</div>

		<button onclick=${() => count.v++}> + </button>
		<button onclick=${decrement}> - </button>
		<button onclick=${changeColor}>Change color</button>
		<button onclick=${() => width.v = (parseInt(width.v) + 20) + "px"}>Increase width</button>

		<p width=${width}>${prop2}</p>

		<input type="text" :value=${input}></input>
		<p>${input}</p>

		<my-test func=${decrement} prop1=${input} :prop2=${width}></my-test>
		
		<slot name="slot2"></slot>
		<slot name="slot1"></slot>`;
});