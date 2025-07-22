import token from '../dist/token.js';

token("my-slot", () => {
    return html`
		<div>
            <div>
                <slot>
                    <p class="text-gray-600">This is a default slot content.</p>
                </slot>
            </div>
		</div>
	`;
});
