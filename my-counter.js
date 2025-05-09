import {token, signal, effect} from './framework/token.js';
import MyTest from './my-test.js';

const testGlobalSignal = signal('Hello World');
const testGlobalChange = () => {
	testGlobalSignal.v = testGlobalSignal.v === 'Hello World' ? 'Goodbye World' : 'Hello World';
};

token("my-counter", ({ width = signal("150px"), prop2 = signal("Hello World") }) => {
	const count = signal(1);
	const derived = computed(() => count.v * 2);
	const color = signal('text-black');
	const input = signal('Hello World');

	const URL = computed(() => `https://jsonplaceholder.typicode.com/todos/${count.v}`);
	const APIData = computed.fromResource(URL);

	const title = computed(() => {
		if (APIData.loading.v)
			return 'loading...';
		else if (APIData.error.v)
			return 'error';
		else
			return APIData.data.v?.title;
	});

	effect(() => {
		console.log('title', title.v);
	});

	const decrement = () => {
		count.v--;
	};

	const changeColor = () => {
        color.v = color.v === 'text-black' ? 'text-red-500' : 'text-black';
    };

	const handler = async () => {
		const data = await fetch('https://jsonplaceholder.typicode.com/todos/1');
		const json = await data.json();
		input.v = json.title;
	}

	let runs = 0;

	effect.debounced(() => {
		count.v;
		runs++;
	}, 5000);

	html`
		<div class="max-w-md mx-auto p-6 bg-gray-100 rounded-lg shadow-md mb-6">
			<div class="mb-6">
				<div class="${color} text-xl font-semibold bg-gray-200 p-3 rounded mb-2 w-[${width}]">Current count: ${count}</div>
                <div class="${color} mb-1">Doubled count: ${derived}</div>
                <div class="${color} mb-4">Current count: ${count}; doubled count: ${derived}</div>
            </div>

			<div class="flex flex-wrap gap-2 mb-6">
				<button class="bg-blue-500 hover:bg-blue-600 text-white px-4 py-2 rounded" onclick=${() => count.v++}> + </button>
				<button class="bg-blue-500 hover:bg-blue-600 text-white px-4 py-2 rounded" onclick=${decrement}> - </button>
				<button class="bg-purple-500 hover:bg-purple-600 text-white px-4 py-2 rounded" onclick=${changeColor}>Change color</button>
				<button class="bg-green-500 hover:bg-green-600 text-white px-4 py-2 rounded" onclick=${() => width.v = (parseInt(width.v) + 20) + "px"}>Increase width</button>
				<button class="bg-yellow-500 hover:bg-yellow-600 text-white px-4 py-2 rounded" onclick=${testGlobalChange}>Change global signal</button>
			</div>

			<div class="mb-4">
				<h1 class="text-2xl font-bold mb-2">${testGlobalSignal}</h1>
				<p class="w-${width} p-2 border border-gray-300 rounded">${prop2}</p>
			</div>

			<div class="mb-4">
				<button class="bg-indigo-500 hover:bg-indigo-600 text-white px-4 py-2 rounded mb-4" onclick=${handler}>Fetch</button>
				
				<div class="flex flex-col gap-2">
					<input type="text" :value=${input} class="border border-gray-300 p-2 rounded">
					<p class="italic">${input}</p>
				</div>
			</div>

			<${MyTest} class="block mt-4 p-4 bg-gray-50 border border-gray-200 rounded" func=${decrement} prop1=${input} :prop2=${width}></${MyTest}>


			<div class="mt-6 p-4 bg-gray-50 rounded border border-gray-200">
				<p await=${APIData} class="font-medium">
					${()=>APIData.data.title}
				<br loading>
					loading...
				<br error>
					error.
				</p>
			</div>
				
			<div class="mt-6 p-4 bg-gray-50 rounded border border-gray-200">
				<p if=${APIData.loading} class="font-medium">
					loading...
				<br elseif=${APIData.error}>
					error.
				<br else>
					${()=>APIData.data.title}
				</p>
			</div>


		</div>`;
});