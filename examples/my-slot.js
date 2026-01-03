import token from '../dist/token.js';

token("my-slot", () => {
    return html`
        <div class="p-4 border border-gray-300 rounded">
            <slot>
                <p class="text-gray-600">This is a default slot content.</p>
            </slot>
        </div>
	`;
});
