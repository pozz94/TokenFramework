import token from './framework/token.js';

token("my-test", ({ func, prop1, prop2 }) => html`
    <div class="space-y-3">
        <p class="text-gray-700 font-medium">${prop2}</p>
        
        <input 
            type="text" 
            :value=${prop1}
            class="w-full border border-gray-300 rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500">
        
        <p class="italic text-gray-600">${prop1}</p>
        
        <div class="flex gap-2">
            <button 
                onclick=${() => { func(); console.log('asdf') }}
                class="bg-blue-500 hover:bg-blue-600 text-white px-3 py-1 rounded transition">
                Change Count
            </button>
            
            <button 
                onclick=${() => { prop2.v = '20px' }}
                class="bg-purple-500 hover:bg-purple-600 text-white px-3 py-1 rounded transition">
                Change Size
            </button>
        </div>
    </div>
`);