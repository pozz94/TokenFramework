import token from '../src/token.js';

token("effect-test", () => {
    const testSignal = signal(0);
    const signalChanges = signal(0);
    const testThrottled = signal(0);
    const throttledChanges = signal(0);
    const testDebounced = signal(0);
    const debouncedChanges = signal(0);
    const testUI = signal(0);
    const UIChanges = signal(0);

    const active = signal(false);

    let interval;

    effect(() => {
        if (active.v)
            effect.untrack(() => interval = setInterval(() => {
                if (active.v) testSignal.v++;
                if (active.v) signalChanges.v++;
                setTimeout(() => {
                    if (active.v) testSignal.v++;
                    if (active.v) signalChanges.v++;
                }, 1);
                setTimeout(() => {
                    if (active.v) testSignal.v++;
                    if (active.v) signalChanges.v++;
                }, 2);
                setTimeout(() => {
                    if (active.v) testSignal.v++;
                    if (active.v) signalChanges.v++;
                }, 3);
            }, 4));
        else clearInterval(interval);
    });

    effect.throttled(() => {
        testThrottled.v = testSignal.v;
        effect.untrack(() => throttledChanges.v++);
    }, 1000);

    effect.debounced(() => {
        testDebounced.v = testSignal.v;
        effect.untrack(() => debouncedChanges.v++);
    }, 1000);

    effect.UI(() => {
        testUI.v = testSignal.v;
        effect.untrack(() => UIChanges.v++);
    });

    html`
        <div class="max-w-md mx-auto p-6 bg-gray-100 rounded-lg shadow-md mb-6">
            <h2 class="text-xl font-bold mb-4 text-gray-800">Effect Test</h2>
            
            <div class="space-y-4">
                <div class="p-3 bg-white rounded shadow-sm">
                    <h3 class="text-sm font-medium text-gray-500 mb-1">Regular Effect</h3>
                    <p class="font-mono">
                        <span class="text-blue-600 font-semibold">${testSignal}</span> 
                        <span class="text-gray-400">|</span> 
                        <span class="text-gray-700">changes: <span class="text-green-600 font-semibold">${signalChanges}</span></span>
                    </p>
                </div>
                
                <div class="p-3 bg-white rounded shadow-sm">
                    <h3 class="text-sm font-medium text-gray-500 mb-1">Throttled Effect (1000ms)</h3>
                    <p class="font-mono">
                        <span class="text-blue-600 font-semibold">${testThrottled}</span>
                        <span class="text-gray-400">|</span>
                        <span class="text-gray-700">changes: <span class="text-green-600 font-semibold">${throttledChanges}</span></span>
                    </p>
                </div>
                
                <div class="p-3 bg-white rounded shadow-sm">
                    <h3 class="text-sm font-medium text-gray-500 mb-1">Debounced Effect (1000ms)</h3>
                    <p class="font-mono">
                        <span class="text-blue-600 font-semibold">${testDebounced}</span>
                        <span class="text-gray-400">|</span>
                        <span class="text-gray-700">changes: <span class="text-green-600 font-semibold">${debouncedChanges}</span></span>
                    </p>
                </div>
                
                <div class="p-3 bg-white rounded shadow-sm">
                    <h3 class="text-sm font-medium text-gray-500 mb-1">UI Effect</h3>
                    <p class="font-mono">
                        <span class="text-blue-600 font-semibold">${testUI}</span>
                        <span class="text-gray-400">|</span>
                        <span class="text-gray-700">changes: <span class="text-green-600 font-semibold">${UIChanges}</span></span>
                    </p>
                </div>
            </div>
            
            <div class="mt-6 flex items-center">
                <input 
                    type="checkbox" 
                    id="active-toggle" 
                    :checked=${active}
                    class="w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 rounded focus:ring-blue-500">
                <label for="active-toggle" class="ml-2 text-gray-700 font-medium">Active</label>
            </div>
        </div>
    `;
});