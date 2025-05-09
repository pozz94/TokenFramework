import token from '../src/token.js';

token("my-list", ({ }) => {
    const list = signal([
        { text: "Buy milk", completed: false },
        { text: "Walk the dog", completed: true },
        { text: "Do homework", completed: false }
    ]);

    effect(() => {
        console.log(list.map(item => item));
    });

    const addTask = () => list.push({ text: "New task", completed: false });

    const number = signal(3);

    html`
        <div class="max-w-md mx-auto p-6 bg-gray-100 rounded-lg shadow-md mb-6">
            <div class="flex flex-col justify-between items-center gap-4">
                <div class="flex justify-between items-center gap-4 w-full">
                    <label>Number of lists</label>
                    <input 
                        type="number"
                        class="px-4 py-2 rounded-lg border border-gray-200 focus:outline-none focus:border-blue-500" 
                        :value=${number}
                        oninput=${e => number.v = Math.max(parseInt(e.target.value), 0)}
                    >
                </div>
                <w if=${number}>
                    <div class="flex justify-between items-center w-full">
                        <h1 class="text-2xl font-bold text-gray-800">My Tasks</h1>
                        <button 
                            onclick=${addTask}
                            class="bg-blue-500 hover:bg-blue-600 text-white px-4 py-2 rounded transition-colors duration-200 shadow"
                        >
                            Add task
                        </button>
                    </div>
                </w>
                
                <w if=${() => list.v.length}>
                    <w each:block=${() => Array(number.v)}>
                        <h3 class="text-lg font-semibold text-gray-800">Task List ${() => blockIndex + 1}</h3>
                        <div class="bg-white rounded-lg shadow overflow-hidden w-full">
                            <ul each:item=${list} class="divide-y divide-gray-200">
                                <li class="flex items-center p-4 hover:bg-gray-50 transition-colors duration-150">
                                    <input 
                                        type="checkbox" 
                                        :checked=${() => item.completed}
                                        class="w-5 h-5 mr-3 accent-blue-500"
                                    >
                                    <input 
                                        type="text" 
                                        class="w-full px-4 py-2 rounded-lg border border-gray-200 focus:outline-none focus:border-blue-500" 
                                        :value=${() => item.text}
                                    >
                                    <w if=${() => item.completed}>
                                        ${() => blockIndex + 1}
                                    </w>
                                    <button
                                        onclick=${() => list.v = list.filter(i => !i.isSame(item)).map(i => i.v)}
                                        class="text-gray-500 hover:text-red-500 ml-3"
                                    >remove</button>
                                </li>
                            </ul>
                        </div>
                    </w>
                </w>
                
                <div class="mt-4 text-sm text-gray-500 flex justify-between w-full">
                    <span>${() => list.v.length} total items</span>
                    <span>${() => list.v.filter(item => item.completed).length} completed</span>
                </div>
            </div>
        </div>
    `;
});