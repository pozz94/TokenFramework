import token from '../src/token.js';
import './test-editor.js';

token('hello-world', () => {
    const code = signal(`
        <script type="module">
            import token from './token.js';

            token("my-greeter", () => {
                html\`<h1>Hello World!!!</h1>\`;
            });
        </script>

        <my-greeter render></my-greeter>`);

    const expectedOutput = signal('<my-greeterrender=""style="display:contents;"><h1>HelloWorld!!!</h1></my-greeter>');

    html`<test-editor initialCode=${code} title="HelloWorld" expectedOutput=${expectedOutput}></test-editor>`;
});