import { token, signal } from './token.js';
import './my-test.js';

const testGlobalSignal = signal('Hello World');
const testGlobalChange = () => {
	testGlobalSignal.v = testGlobalSignal.v === 'Hello World' ? 'Goodbye World' : 'Hello World';
};

token("my-counter", ({ width = signal("150px"), prop2 = signal("Hello World") }) => {
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

	const handler = async () => {
		const data = await fetch('https://jsonplaceholder.typicode.com/todos/1');
		const json = await data.json();
		input.v = json.title;
	}

	const unit = 'px';

	html`
		<slot name="testslot"></slot>
		<div style="color: ${color}; width: ${width}; background-color: lightgray; font-size: 20${unit}">current count: ${count}</div>
		<div style="color: ${color}">doubled count: ${derived}</div>
		<div style="color: ${color}">current count: ${count}; doubled count: ${derived}</div>

		<button onclick=${() => count.v++}> + </button>
		<button onclick=${decrement}> - </button>
		<button onclick=${changeColor}>Change color</button>
		<button onclick=${() => width.v = (parseInt(width.v) + 20) + "px"}>Increase width</button>
		
		<button onclick=${testGlobalChange}>Change global signal</button>
		<h1>${testGlobalSignal}</h1>

		<p width=${width}>${prop2}</p>

		<button onclick=${handler}>Fetch</button>

		<input type="text" :value=${input}>
		<p>${input}</p>

		<my-test slot="testslot" func=${decrement} prop1=${input} :prop2=${width}></my-test>
		
		<style>
			button { margin: 1rem; }

			my-counter { button { background-color: lightblue; }}
		</style>`;
});