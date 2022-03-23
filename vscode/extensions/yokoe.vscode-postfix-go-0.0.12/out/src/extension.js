'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
const vsc = require("vscode");
const postfixCompletionProvider_1 = require("./postfixCompletionProvider");
let completionProvider;
function activate(context) {
    registerCompletionProvider(context);
    context.subscriptions.push(vsc.workspace.onDidChangeConfiguration(() => {
        if (completionProvider) {
            let idx = context.subscriptions.indexOf(completionProvider);
            context.subscriptions.splice(idx, 1);
            completionProvider.dispose();
        }
        registerCompletionProvider(context);
    }));
}
exports.activate = activate;
// tslint:disable-next-line:no-empty
function deactivate() {
}
exports.deactivate = deactivate;
function registerCompletionProvider(context) {
    const provider = new postfixCompletionProvider_1.PostfixCompletionProvider();
    let documentSelector = { scheme: 'file', language: 'go' };
    completionProvider = vsc.languages.registerCompletionItemProvider(documentSelector, provider, '.');
    context.subscriptions.push(completionProvider);
}
//# sourceMappingURL=extension.js.map