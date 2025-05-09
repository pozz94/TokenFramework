import token from '../src/token.js';

const tagName = 'h1';

token("conditional-block", ({}) => {
    const condition = signal(true);
    const otherCondition = signal(false);
    const thirdCondition = signal(false);  // Added third condition

    const text = signal("Hello World");

    html`
        <div class="flex flex-col gap-4 p-6 bg-gray-100 rounded-lg shadow-md max-w-md mx-auto">
            <div class="flex items-center gap-3">
                <input type="checkbox" :checked=${condition} class="w-5 h-5 accent-blue-600">
                <label class="text-gray-700">First Condition</label>
            </div>
            <div class="flex items-center gap-3">
                <input type="checkbox" :checked=${otherCondition} class="w-5 h-5 accent-blue-600">
                <label class="text-gray-700">Second Condition</label>
            </div>
            <div class="flex items-center gap-3">
                <input type="checkbox" :checked=${thirdCondition} class="w-5 h-5 accent-blue-600">
                <label class="text-gray-700">Third Condition</label>
            </div>
            <div class="flex items-center gap-3">
                <input 
                    type="text" 
                    :value=${text} 
                    class="flex-1 px-4 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all"
                    placeholder="Enter text...">
                <label class="text-gray-700 whitespace-nowrap">Text Input</label>
            </div>
            
            <w if=${()=>condition.v && otherCondition.v && thirdCondition.v}>
                <div class="p-4 bg-pink-100 rounded-md">
                    <h3 class="text-lg font-semibold text-pink-800">All Three Conditions Content</h3>
                    <div class="mt-2 text-pink-600">and this additional content too</div>
                </div>
            <br elseif=${()=>condition.v && otherCondition.v}>
                <div class="p-4 bg-yellow-100 rounded-md">
                    <h3 class="text-lg font-semibold text-yellow-800">First Two conditions Content</h3>
                    <div class="mt-2 text-yellow-600">and this additional content too</div>
                </div>
            <br elseif=${()=>condition.v && thirdCondition.v}>
                <div class="p-4 bg-red-100 rounded-md">
                    <h3 class="text-lg font-semibold text-red-800">First and Third Condition Content</h3>
                    <div class="mt-2 text-red-600">and this additional content too</div>
                </div>
            <br elseif=${()=>otherCondition.v && thirdCondition.v}>
                <div class="p-4 bg-indigo-100 rounded-md">
                    <h3 class="text-lg font-semibold text-indigo-800">Second and Third Condition Content</h3>
                    <div class="mt-2 text-indigo-600">and this additional content too</div>
                </div>
            <br elseif=${condition}>
                <div class="p-4 bg-blue-100 rounded-md">
                    <h3 class="text-lg font-semibold text-blue-800">First Condition Content</h3>
                    <div class="mt-2 text-blue-600">and this additional content too</div>
                </div>
            <br elseif=${otherCondition}>
                <div class="p-4 bg-green-100 rounded-md">
                    <h3 class="text-lg font-semibold text-green-800">Second Condition Content</h3>
                    <div class="mt-2 text-green-600">and this additional content too</div>
                </div>
            <br elseif=${thirdCondition}>
                <div class="p-4 bg-purple-100 rounded-md">
                    <h3 class="text-lg font-semibold text-purple-800">Third Condition Content</h3>
                    <div class="mt-2 text-purple-600">Testing the third condition!</div>
                </div>
            <br else>
                <div class="p-4 bg-gray-200 rounded-md">
                    <h3 class="text-lg font-semibold text-gray-800">Default Content</h3>
                    <div class="mt-2 text-gray-600">shown when nothing else matches</div>
                    <div class="mt-2 text-gray-600">${text}</div>
                </div>
            </w>

            <${tagName} class="flex gap-2">test custom tag name for passing custom elements as props</${tagName}>
        </div>`
});