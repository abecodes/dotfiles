'use strict';
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : new P(function (resolve) { resolve(result.value); }).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments)).next());
    });
};
const vscode = require("vscode");
const git_1 = require("./git");
const flow_1 = require("./flow");
function runWrapped(fn, args = []) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            return yield fn(...args);
        }
        catch (e) {
            if (!e.handlers && !e.message) {
                throw e;
            }
            const err = e;
            const chosen = yield vscode.window.showErrorMessage(err.message, ...(err.handlers || []));
            if (!!chosen) {
                return yield runWrapped(chosen.cb);
            }
            return null;
        }
    });
}
function setup(disposables) {
    return __awaiter(this, void 0, void 0, function* () {
        const pathHint = vscode.workspace.getConfiguration('git').get('path');
        git_1.git.info = yield git_1.findGit(pathHint);
        vscode.window.setStatusBarMessage('gitflow using git executable: ' + git_1.git.info.path + ' with version ' +
            git_1.git.info.version, 5000);
        const commands = [
            vscode.commands.registerCommand('gitflow.initialize', () => __awaiter(this, void 0, void 0, function* () {
                yield runWrapped(flow_1.flow.initialize);
            })),
            vscode.commands.registerCommand('gitflow.featureStart', () => __awaiter(this, void 0, void 0, function* () {
                yield runWrapped(flow_1.flow.requireFlowEnabled);
                yield runWrapped(flow_1.flow.feature.precheck);
                const name = yield vscode.window.showInputBox({
                    placeHolder: 'my-awesome-feature',
                    prompt: 'A new name for your feature',
                });
                if (!name) {
                    return;
                }
                yield runWrapped(flow_1.flow.feature.start, [name, 'feature']);
            })),
            vscode.commands.registerCommand('gitflow.featureRebase', () => __awaiter(this, void 0, void 0, function* () {
                yield runWrapped(flow_1.flow.feature.rebase, ['feature']);
            })),
            vscode.commands.registerCommand('gitflow.featureFinish', () => __awaiter(this, void 0, void 0, function* () {
                yield runWrapped(flow_1.flow.feature.finish, ['feature']);
            })),
            vscode.commands.registerCommand('gitflow.bugfixStart', () => __awaiter(this, void 0, void 0, function* () {
                yield runWrapped(flow_1.flow.requireFlowEnabled);
                yield runWrapped(flow_1.flow.feature.precheck);
                const name = yield vscode.window.showInputBox({
                    placeHolder: 'my-awesome-bugfix',
                    prompt: 'A new name for your bugfix',
                });
                if (!name) {
                    return;
                }
                yield runWrapped(flow_1.flow.feature.start, [name, 'bugfix']);
            })),
            vscode.commands.registerCommand('gitflow.bugfixRebase', () => __awaiter(this, void 0, void 0, function* () {
                yield runWrapped(flow_1.flow.feature.rebase, ['bugfix']);
            })),
            vscode.commands.registerCommand('gitflow.bugfixFinish', () => __awaiter(this, void 0, void 0, function* () {
                yield runWrapped(flow_1.flow.feature.finish, ['bugfix']);
            })),
            vscode.commands.registerCommand('gitflow.releaseStart', () => __awaiter(this, void 0, void 0, function* () {
                yield runWrapped(flow_1.flow.requireFlowEnabled);
                yield runWrapped(flow_1.flow.release.precheck);
                const guessedVersion = (yield runWrapped(flow_1.flow.release.guess_new_version)) || '';
                const name = yield vscode.window.showInputBox({
                    placeHolder: guessedVersion,
                    prompt: 'The name of the release',
                    value: guessedVersion,
                });
                if (!name) {
                    return;
                }
                yield runWrapped(flow_1.flow.release.start, [name]);
            })),
            vscode.commands.registerCommand('gitflow.releaseFinish', () => __awaiter(this, void 0, void 0, function* () {
                yield runWrapped(flow_1.flow.release.finish);
            })),
            vscode.commands.registerCommand('gitflow.hotfixStart', () => __awaiter(this, void 0, void 0, function* () {
                yield runWrapped(flow_1.flow.requireFlowEnabled);
                const guessedVersion = (yield runWrapped(flow_1.flow.hotfix.guess_new_version)) || '';
                const name = yield vscode.window.showInputBox({
                    placeHolder: guessedVersion,
                    prompt: 'The name of the hotfix version',
                    value: guessedVersion,
                });
                if (!name) {
                    return;
                }
                yield runWrapped(flow_1.flow.hotfix.start, [name]);
            })),
            vscode.commands.registerCommand('gitflow.hotfixFinish', () => __awaiter(this, void 0, void 0, function* () {
                yield runWrapped(flow_1.flow.hotfix.finish);
            })),
        ];
        // add disposable
        disposables.push(...commands);
    });
}
function activate(context) {
    const disposables = [];
    context.subscriptions.push(new vscode.Disposable(() => vscode.Disposable.from(...disposables).dispose()));
    setup(disposables).catch((err) => console.error(err));
}
exports.activate = activate;
function 
// tslint:disable-next-line:no-empty
deactivate() { }
exports.deactivate = deactivate;
//# sourceMappingURL=extension.js.map